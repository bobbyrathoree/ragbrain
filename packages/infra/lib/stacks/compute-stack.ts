import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface ComputeStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  storageBucket: s3.Bucket;
  thoughtsTable: dynamodb.Table;
  indexQueue: sqs.Queue;
  searchCollection: opensearch.CfnCollection;
}

export class ComputeStack extends cdk.Stack {
  public readonly captureLambda: lambda.Function;
  public readonly indexerLambda: lambda.Function;
  public readonly askLambda: lambda.Function;
  public readonly thoughtsLambda: lambda.Function;
  public readonly graphLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      projectName,
      environment,
      storageBucket,
      thoughtsTable,
      indexQueue,
      searchCollection,
    } = props;

    // Shared Lambda layer for common dependencies
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/shared')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Shared dependencies for all Lambda functions',
    });

    // Bedrock access policy
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-*`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-*`,
      ],
    });

    // Environment variables shared across functions
    const commonEnv = {
      PROJECT_NAME: projectName,
      ENVIRONMENT: environment,
      REGION: this.region,
      BUCKET_NAME: storageBucket.bucketName,
      TABLE_NAME: thoughtsTable.tableName,
      SEARCH_ENDPOINT: searchCollection.attrCollectionEndpoint,
      SEARCH_COLLECTION: searchCollection.name,
    };

    // Common bundling options for all Lambda functions
    const bundlingOptions = {
      minify: environment === 'prod',
      sourceMap: environment !== 'prod',
      // Mark packages from Lambda layer as external
      externalModules: [
        '@aws-sdk/*',
        '@opensearch-project/opensearch',
        '@opensearch-project/opensearch/*',
        'uuid',
      ],
      // Use local esbuild if available, otherwise Docker
      forceDockerBundling: false,
      // Add path aliases to resolve @ultrathink/shared
      define: {
        'process.env.NODE_ENV': JSON.stringify(environment),
      },
      esbuildArgs: {
        '--alias:@ultrathink/shared': path.join(__dirname, '../../../shared/src'),
      },
    };

    // Capture Lambda - handles incoming thoughts
    this.captureLambda = new lambdaNodejs.NodejsFunction(this, 'CaptureLambda', {
      functionName: `${projectName}-capture-${environment}`,
      entry: path.join(__dirname, '../../functions/capture/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnv,
        QUEUE_URL: indexQueue.queueUrl,
      },
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      bundling: bundlingOptions,
    });

    // Grant permissions
    storageBucket.grantWrite(this.captureLambda);
    thoughtsTable.grantWriteData(this.captureLambda);
    indexQueue.grantSendMessages(this.captureLambda);

    // Indexer Lambda - processes thoughts for search
    this.indexerLambda = new lambdaNodejs.NodejsFunction(this, 'IndexerLambda', {
      functionName: `${projectName}-indexer-${environment}`,
      entry: path.join(__dirname, '../../functions/indexer/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(120),
      environment: commonEnv,
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      reservedConcurrentExecutions: 10, // Limit concurrency to avoid Bedrock throttling
      bundling: bundlingOptions,
    });

    // Add SQS trigger
    this.indexerLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(indexQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
      })
    );

    // Grant permissions
    storageBucket.grantRead(this.indexerLambda);
    thoughtsTable.grantReadWriteData(this.indexerLambda);
    this.indexerLambda.addToRolePolicy(bedrockPolicy);

    // OpenSearch permissions
    this.indexerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [
          `arn:aws:aoss:${this.region}:${this.account}:collection/${searchCollection.attrId}`,
        ],
      })
    );

    // Ask Lambda - handles queries and generates answers
    this.askLambda = new lambdaNodejs.NodejsFunction(this, 'AskLambda', {
      functionName: `${projectName}-ask-${environment}`,
      entry: path.join(__dirname, '../../functions/ask/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      bundling: bundlingOptions,
    });

    // Grant permissions
    thoughtsTable.grantReadData(this.askLambda);
    this.askLambda.addToRolePolicy(bedrockPolicy);
    this.askLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [
          `arn:aws:aoss:${this.region}:${this.account}:collection/${searchCollection.attrId}`,
        ],
      })
    );

    // Thoughts Lambda - lists and filters thoughts
    this.thoughtsLambda = new lambdaNodejs.NodejsFunction(this, 'ThoughtsLambda', {
      functionName: `${projectName}-thoughts-${environment}`,
      entry: path.join(__dirname, '../../functions/thoughts/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      bundling: bundlingOptions,
    });

    thoughtsTable.grantReadData(this.thoughtsLambda);

    // Graph Lambda - builds visualization data
    this.graphLambda = new lambdaNodejs.NodejsFunction(this, 'GraphLambda', {
      functionName: `${projectName}-graph-${environment}`,
      entry: path.join(__dirname, '../../functions/graph/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(120),
      environment: {
        ...commonEnv,
        GRAPH_BUCKET: storageBucket.bucketName,
      },
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      bundling: bundlingOptions,
    });

    // Grant permissions
    thoughtsTable.grantReadData(this.graphLambda);
    storageBucket.grantReadWrite(this.graphLambda, 'graph/*');
    this.graphLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [
          `arn:aws:aoss:${this.region}:${this.account}:collection/${searchCollection.attrId}`,
        ],
      })
    );

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'CaptureLambdaArn', {
      value: this.captureLambda.functionArn,
      description: 'Capture Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'IndexerLambdaArn', {
      value: this.indexerLambda.functionArn,
      description: 'Indexer Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'AskLambdaArn', {
      value: this.askLambda.functionArn,
      description: 'Ask Lambda function ARN',
    });

    // Tags
    cdk.Tags.of(this).add('Stack', 'Compute');
  }
}