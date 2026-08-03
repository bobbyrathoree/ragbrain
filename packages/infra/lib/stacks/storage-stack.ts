import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
}

export class StorageStack extends cdk.Stack {
  public readonly storageBucket: s3.Bucket;
  public readonly thoughtsTable: dynamodb.Table;
  public readonly indexQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly encryptionKey: kms.Key;
  public readonly apiKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;

    // KMS key for encryption
    this.encryptionKey = new kms.Key(this, 'EncryptionKey', {
      description: `${projectName} encryption key for ${environment}`,
      enableKeyRotation: true,
      alias: `${projectName}-${environment}`,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // API key for v1 (will be replaced with Cognito later)
    // Import existing secret from api-stack migration
    this.apiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ApiKey',
      `${projectName}/${environment}/api-key`
    );

    // S3 bucket for raw thought storage
    this.storageBucket = new s3.Bucket(this, 'StorageBucket', {
      bucketName: `${projectName}-raw-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      versioned: true,
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
        {
          id: 'transition-to-ia',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: environment === 'prod'
            ? ['https://ragbrain.app', 'https://www.ragbrain.app']
            : ['http://localhost:3000', 'http://localhost:8080'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // DynamoDB table for thought metadata
    this.thoughtsTable = new dynamodb.Table(this, 'ThoughtsTable', {
      tableName: `${projectName}-thoughts-${environment}`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecovery: environment === 'prod',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      // NOTE: no timeToLiveAttribute. This table previously expired every item
      // 365 days after capture, which silently deleted notes from the Feed and
      // from /export while they remained in OpenSearch. A permanent-memory
      // product must not expire its own source of truth.
      // See docs/AUDIT-2026-08.md finding 3.
    });

    // NOTE: gsi1 (`type#<type>` / `ts#<epoch>`, ProjectionType.ALL) and gsi2
    // (`type` / `createdAt`, projecting text) have been REMOVED. Neither was
    // partitioned by user, so any query against them crossed the tenant
    // boundary: `GET /thoughts?type=note` returned every user's full note text
    // to any authenticated caller. Reproduced live before removal.
    //
    // gsi1 was the only one ever queried; gsi2 was never read by any handler and
    // duplicated the same flaw. `type` is now a FilterExpression on the caller's
    // own partition (see functions/thoughts/index.ts).
    //
    // Do not add an index whose partition key omits the user. If a future access
    // pattern needs one, key it `user#<user>#type#<type>` so the tenant boundary
    // is enforced by the key itself rather than by remembering to filter.
    // See docs/AUDIT-2026-08.md finding 11.
    //
    // Removed in two deploys, because DynamoDB permits only one GSI creation or
    // deletion per stack update ("Cannot perform more than one GSI creation or
    // deletion in a single update"). Anyone re-adding an index here should expect
    // the same constraint.

    // GSI3 for listing conversations by user, sorted by last update
    this.thoughtsTable.addGlobalSecondaryIndex({
      indexName: 'gsi3',
      partitionKey: {
        name: 'gsi3pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi3sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Dead Letter Queue
    this.dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `${projectName}-dlq-${environment}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS queue for indexing pipeline
    this.indexQueue = new sqs.Queue(this, 'IndexQueue', {
      queueName: `${projectName}-index-${environment}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
      },
      receiveMessageWaitTime: cdk.Duration.seconds(20), // Long polling
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.storageBucket.bucketName,
      description: 'S3 bucket for raw thought storage',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.thoughtsTable.tableName,
      description: 'DynamoDB table for thought metadata',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: this.indexQueue.queueUrl,
      description: 'SQS queue URL for indexing',
    });

    new cdk.CfnOutput(this, 'ApiKeySecretArn', {
      value: this.apiKeySecret.secretArn,
      description: 'API key secret ARN',
    });

    // Tags
    cdk.Tags.of(this).add('Stack', 'Storage');
  }
}