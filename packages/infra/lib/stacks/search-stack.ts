import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface SearchStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
}

export class SearchStack extends cdk.Stack {
  public readonly searchCollection: opensearch.CfnCollection;
  public readonly searchAccessPolicy: opensearch.CfnAccessPolicy;
  public readonly searchEndpoint: string;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;
    const collectionName = `${projectName}-${environment}`;

    // Security policy for encryption
    const encryptionPolicy = new opensearch.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${collectionName}-encryption`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            Resource: [`collection/${collectionName}`],
            ResourceType: 'collection',
          },
        ],
        AWSOwnedKey: true,
      }),
    });

    // Network policy for collection
    const networkPolicy = new opensearch.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${collectionName}-network`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${collectionName}`],
              ResourceType: 'collection',
            },
          ],
          AllowFromPublic: true, // Will restrict with IAM
        },
      ]),
    });

    // Create OpenSearch Serverless collection
    this.searchCollection = new opensearch.CfnCollection(this, 'SearchCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: `Vector search collection for ${projectName} ${environment}`,
      standbyReplicas: environment === 'prod' ? 'ENABLED' : 'DISABLED',
    });

    this.searchCollection.addDependency(encryptionPolicy);
    this.searchCollection.addDependency(networkPolicy);

    // IAM role for Lambda access
    const searchRole = new iam.Role(this, 'SearchRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Data access policy
    this.searchAccessPolicy = new opensearch.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `${collectionName}-access`,
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems',
              ],
              ResourceType: 'collection',
            },
            {
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
              ResourceType: 'index',
            },
          ],
          Principal: [
            searchRole.roleArn,
            `arn:aws:iam::${this.account}:root`, // Account root for initial setup
          ],
        },
      ]),
    });

    // Store endpoint for use by other stacks
    this.searchEndpoint = this.searchCollection.attrCollectionEndpoint;

    // Store credentials in Secrets Manager
    const searchCredentials = new secretsmanager.Secret(this, 'SearchCredentials', {
      secretName: `${projectName}/${environment}/opensearch`,
      description: 'OpenSearch Serverless access credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          endpoint: this.searchEndpoint,
          collectionName: collectionName,
        }),
        generateStringKey: 'apiKey',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    // Grant Lambda role permissions
    searchRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'aoss:APIAccessAll',
        ],
        resources: [
          `arn:aws:aoss:${this.region}:${this.account}:collection/${this.searchCollection.attrId}`,
        ],
      })
    );

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.searchEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
    });

    new cdk.CfnOutput(this, 'CollectionName', {
      value: collectionName,
      description: 'OpenSearch collection name',
    });

    new cdk.CfnOutput(this, 'SearchRoleArn', {
      value: searchRole.roleArn,
      description: 'IAM role for accessing OpenSearch',
      exportName: `${projectName}-${environment}-search-role`,
    });

    // Tags
    cdk.Tags.of(this).add('Stack', 'Search');
  }
}