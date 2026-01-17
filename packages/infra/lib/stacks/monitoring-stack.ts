import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';

interface MonitoringStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  api: apigateway.HttpApi;
  lambdas: lambda.Function[];
  dlq: sqs.Queue;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { projectName, environment, api, lambdas, dlq } = props;

    // SNS topic for alarms
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${projectName}-alarms-${environment}`,
      displayName: `Ragbrain ${environment} Alarms`,
    });

    // Add email subscription (replace with your email)
    if (environment === 'prod') {
      this.alarmTopic.addSubscription(
        new snsSubscriptions.EmailSubscription('alerts@ragbrain.dev')
      );
    }

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${projectName}-${environment}`,
      defaultInterval: cdk.Duration.hours(3),
    });

    // API Metrics
    const apiRequestsWidget = new cloudwatch.GraphWidget({
      title: 'API Requests',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '4xx',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.ORANGE,
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '5xx',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.RED,
        }),
      ],
      width: 12,
      height: 6,
    });

    const apiLatencyWidget = new cloudwatch.GraphWidget({
      title: 'API Latency',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'p95',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.ORANGE,
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: {
            ApiId: api.apiId,
            Stage: environment,
          },
          statistic: 'p99',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.RED,
        }),
      ],
      width: 12,
      height: 6,
    });

    // Lambda Metrics
    const lambdaWidgets = lambdas.map((fn) => {
      return new cloudwatch.GraphWidget({
        title: `${fn.functionName} Performance`,
        left: [
          fn.metricInvocations({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          fn.metricErrors({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            color: cloudwatch.Color.RED,
          }),
        ],
        right: [
          fn.metricDuration({
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
          fn.metricDuration({
            statistic: 'p95',
            period: cdk.Duration.minutes(5),
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 8,
        height: 6,
      });
    });

    // DLQ Metrics
    const dlqWidget = new cloudwatch.GraphWidget({
      title: 'Dead Letter Queue',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: {
            QueueName: dlq.queueName,
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.RED,
        }),
      ],
      width: 8,
      height: 6,
    });

    // Custom metrics
    const customMetricsWidget = new cloudwatch.GraphWidget({
      title: 'Application Metrics',
      left: [
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'CaptureLatency',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'IndexLatency',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'AskLatency',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'CitationCount',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'AbstainRate',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
      ],
      width: 8,
      height: 6,
    });

    // Add widgets to dashboard
    this.dashboard.addWidgets(apiRequestsWidget, apiLatencyWidget);
    this.dashboard.addWidgets(...lambdaWidgets);
    this.dashboard.addWidgets(dlqWidget, customMetricsWidget);

    // Alarms

    // API 5xx errors
    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: `${projectName}-${environment}-api-5xx`,
      alarmDescription: 'API 5xx errors exceed threshold',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: {
          ApiId: api.apiId,
          Stage: environment,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // API latency p95
    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: `${projectName}-${environment}-api-latency`,
      alarmDescription: 'API p95 latency exceeds 4 seconds',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Latency',
        dimensionsMap: {
          ApiId: api.apiId,
          Stage: environment,
        },
        statistic: 'p95',
        period: cdk.Duration.minutes(10),
      }),
      threshold: 4000,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // Lambda error alarms
    lambdas.forEach((fn) => {
      const errorAlarm = new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        alarmName: `${fn.functionName}-errors`,
        alarmDescription: `${fn.functionName} error rate exceeds 1%`,
        metric: new cloudwatch.MathExpression({
          expression: 'errors / invocations * 100',
          usingMetrics: {
            errors: fn.metricErrors({
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
            invocations: fn.metricInvocations({
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
          },
        }),
        threshold: 1,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

      // Duration alarm for critical functions
      if (fn.functionName?.includes('ask') || fn.functionName?.includes('capture')) {
        const durationAlarm = new cloudwatch.Alarm(this, `${fn.node.id}DurationAlarm`, {
          alarmName: `${fn.functionName}-duration`,
          alarmDescription: `${fn.functionName} p95 duration exceeds threshold`,
          metric: fn.metricDuration({
            statistic: 'p95',
            period: cdk.Duration.minutes(5),
          }),
          threshold: fn.functionName?.includes('ask') ? 3000 : 1000,
          evaluationPeriods: 2,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
      }
    });

    // DLQ alarm
    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqAlarm', {
      alarmName: `${projectName}-${environment}-dlq`,
      alarmDescription: 'Messages in DLQ',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: {
          QueueName: dlq.queueName,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS topic for alarms',
    });

    // Tags
    cdk.Tags.of(this).add('Stack', 'Monitoring');
  }
}