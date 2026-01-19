import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  captureLambda: lambda.IFunction;
  askLambda: lambda.IFunction;
  thoughtsLambda: lambda.Function;
  graphLambda: lambda.Function;
  conversationsLambda: lambda.Function;
  exportLambda: lambda.Function;
  apiKeySecret: secretsmanager.ISecret;
  thoughtsTable: dynamodb.ITable;
  sharedLayer: lambda.ILayerVersion;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.HttpApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      projectName,
      environment,
      captureLambda,
      askLambda,
      thoughtsLambda,
      graphLambda,
      conversationsLambda,
      exportLambda,
      apiKeySecret,
      thoughtsTable,
      sharedLayer,
    } = props;

    // Common bundling options
    const bundlingOptions = {
      minify: environment === 'prod',
      sourceMap: environment !== 'prod',
      externalModules: [
        '@aws-sdk/*',
        '@opensearch-project/opensearch',
        '@opensearch-project/opensearch/*',
        'uuid',
      ],
      forceDockerBundling: false,
      define: {
        'process.env.NODE_ENV': JSON.stringify(environment),
      },
    };

    // Authorizer Lambda - handles API key validation and rate limiting
    const authorizerLambda = new lambdaNodejs.NodejsFunction(this, 'AuthorizerLambdaV2', {
      functionName: `${projectName}-authorizer-v2-${environment}`,
      entry: path.join(__dirname, '../../functions/authorizer/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: thoughtsTable.tableName,
        RATE_LIMIT_PER_HOUR: environment === 'prod' ? '10000' : '1000',
        SECRET_ARN: apiKeySecret.secretArn,
      },
      layers: [sharedLayer],
      tracing: lambda.Tracing.ACTIVE,
      bundling: bundlingOptions,
    });

    // Grant permissions for Authorizer Lambda
    thoughtsTable.grantReadWriteData(authorizerLambda);
    apiKeySecret.grantRead(authorizerLambda);

    // Define allowed CORS origins based on environment
    // Note: API Gateway only accepts http/https origins, not custom schemes like tauri:// or capacitor://
    // Desktop/mobile apps using custom schemes must handle CORS differently or use '*' carefully
    const allowedOrigins = environment === 'prod'
      ? ['https://ragbrain.app', 'https://www.ragbrain.app']
      : ['http://localhost:3000', 'http://localhost:8080'];

    // Create HTTP API
    this.api = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `${projectName}-${environment}`,
      description: `Ragbrain API for ${environment}`,
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [
          apigateway.CorsHttpMethod.GET,
          apigateway.CorsHttpMethod.POST,
          apigateway.CorsHttpMethod.PUT,
          apigateway.CorsHttpMethod.DELETE,
          apigateway.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
      createDefaultStage: false,
    });

    // Create custom authorizer
    const authorizer = new apigatewayAuthorizers.HttpLambdaAuthorizer(
      'ApiKeyAuthorizer',
      authorizerLambda,
      {
        responseTypes: [apigatewayAuthorizers.HttpLambdaResponseType.SIMPLE],
        identitySource: ['$request.header.x-api-key'],
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // API stage with throttling
    const stage = new apigateway.HttpStage(this, 'Stage', {
      httpApi: this.api,
      stageName: environment,
      autoDeploy: true,
      throttle: {
        rateLimit: environment === 'prod' ? 1000 : 100,
        burstLimit: environment === 'prod' ? 2000 : 200,
      },
    });

    // Access logging
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: `/aws/apigateway/${projectName}-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    stage.node.addDependency(logGroup);
    
    const cfnStage = stage.node.defaultChild as apigateway.CfnStage;
    cfnStage.accessLogSettings = {
      destinationArn: logGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        httpMethod: '$context.httpMethod',
        routeKey: '$context.routeKey',
        status: '$context.status',
        protocol: '$context.protocol',
        responseLength: '$context.responseLength',
        error: '$context.error.message',
        integrationError: '$context.integrationErrorMessage',
      }),
    };

    // Routes
    
    // POST /thoughts - Capture thought
    this.api.addRoutes({
      path: '/thoughts',
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'CaptureIntegration',
        captureLambda
      ),
      authorizer,
    });

    // GET /thoughts - List thoughts
    this.api.addRoutes({
      path: '/thoughts',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ThoughtsIntegration',
        thoughtsLambda
      ),
      authorizer,
    });

    // GET /thoughts/{id}/related - Get related thoughts
    this.api.addRoutes({
      path: '/thoughts/{id}/related',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'RelatedThoughtsIntegration',
        thoughtsLambda
      ),
      authorizer,
    });

    // POST /ask - Ask questions
    this.api.addRoutes({
      path: '/ask',
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'AskIntegration',
        askLambda
      ),
      authorizer,
    });

    // GET /graph - Get graph data
    this.api.addRoutes({
      path: '/graph',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'GraphIntegration',
        graphLambda
      ),
      authorizer,
    });

    // Conversation routes

    // POST /conversations - Create conversation
    // GET /conversations - List conversations
    this.api.addRoutes({
      path: '/conversations',
      methods: [apigateway.HttpMethod.POST, apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ConversationsIntegration',
        conversationsLambda
      ),
      authorizer,
    });

    // GET /conversations/{id} - Get conversation with messages
    // PUT /conversations/{id} - Update conversation
    // DELETE /conversations/{id} - Delete conversation
    this.api.addRoutes({
      path: '/conversations/{id}',
      methods: [apigateway.HttpMethod.GET, apigateway.HttpMethod.PUT, apigateway.HttpMethod.DELETE],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ConversationDetailIntegration',
        conversationsLambda
      ),
      authorizer,
    });

    // POST /conversations/{id}/messages - Send message
    this.api.addRoutes({
      path: '/conversations/{id}/messages',
      methods: [apigateway.HttpMethod.POST],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ConversationMessagesIntegration',
        conversationsLambda
      ),
      authorizer,
    });

    // GET /export - Export data for Obsidian sync
    this.api.addRoutes({
      path: '/export',
      methods: [apigateway.HttpMethod.GET],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ExportIntegration',
        exportLambda
      ),
      authorizer,
    });

    // WAF Web ACL for additional protection (production only)
    if (environment === 'prod') {
      const webAcl = new waf.CfnWebACL(this, 'ApiWafAcl', {
        name: `${projectName}-api-waf-${environment}`,
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${projectName}-api-waf`,
          sampledRequestsEnabled: true,
        },
        rules: [
          // AWS Managed Rules - Common Rule Set
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSet',
              sampledRequestsEnabled: true,
            },
          },
          // AWS Managed Rules - Known Bad Inputs
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'KnownBadInputs',
              sampledRequestsEnabled: true,
            },
          },
          // Rate limiting rule - 2000 requests per 5 minutes per IP
          {
            name: 'RateLimitRule',
            priority: 3,
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: 'IP',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'RateLimit',
              sampledRequestsEnabled: true,
            },
          },
        ],
      });

      // Output WAF ARN for reference
      new cdk.CfnOutput(this, 'WafAclArn', {
        value: webAcl.attrArn,
        description: 'WAF Web ACL ARN',
      });
    }

    this.apiUrl = stage.url;

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'ApiKeySecretArn', {
      value: apiKeySecret.secretArn,
      description: 'API key secret ARN',
    });

    // Tags
    cdk.Tags.of(this).add('Stack', 'API');
  }
}