import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  captureLambda: lambda.Function;
  askLambda: lambda.Function;
  thoughtsLambda: lambda.Function;
  graphLambda: lambda.Function;
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
    } = props;

    // API key for v1 (will be replaced with Cognito later)
    const apiKeySecret = new secretsmanager.Secret(this, 'ApiKey', {
      secretName: `${projectName}/${environment}/api-key`,
      description: 'API key for Ultrathink v1',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'key',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
        passwordLength: 32,
      },
    });

    // Custom authorizer Lambda
    const authorizerLambda = new lambda.Function(this, 'AuthorizerLambda', {
      functionName: `${projectName}-authorizer-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('@aws-sdk/client-secrets-manager');
        const secretsManager = new AWS.SecretsManager();
        
        exports.handler = async (event) => {
          const apiKey = event.headers['x-api-key'];
          
          if (!apiKey) {
            return {
              isAuthorized: false,
            };
          }
          
          try {
            const secret = await secretsManager.getSecretValue({
              SecretId: '${apiKeySecret.secretArn}',
            });
            
            const { key } = JSON.parse(secret.SecretString);
            
            return {
              isAuthorized: apiKey === key,
              context: {
                user: 'dev', // Single user for v1
              },
            };
          } catch (error) {
            console.error('Authorization error:', error);
            return {
              isAuthorized: false,
            };
          }
        };
      `),
      environment: {
        SECRET_ARN: apiKeySecret.secretArn,
      },
      timeout: cdk.Duration.seconds(10),
    });

    apiKeySecret.grantRead(authorizerLambda);

    // Create HTTP API
    this.api = new apigateway.HttpApi(this, 'HttpApi', {
      apiName: `${projectName}-${environment}`,
      description: `Ultrathink API for ${environment}`,
      corsPreflight: {
        allowOrigins: ['*'], // Will restrict to app bundle later
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

    // WAF Web ACL for additional protection
    const webAcl = new waf.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${projectName}-${environment}-waf`,
      },
      rules: [
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
          },
        },
      ],
    });

    // Associate WAF with API
    // Construct the stage ARN for HTTP API
    const stageArn = `arn:aws:apigateway:${this.region}::/apis/${this.api.httpApiId}/stages/${environment}`;
    new waf.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: stageArn,
      webAclArn: webAcl.attrArn,
    });

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