import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
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
          metricName: 'SearchHitCount',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
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
        new cloudwatch.Metric({
          namespace: projectName,
          metricName: 'HybridSearchFallback',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          color: cloudwatch.Color.RED,
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

    // Search hit count alarm — fires when multiple /ask queries return zero results,
    // indicating OpenSearch indexing is broken (not just a single off-topic query)
    const searchHitAlarm = new cloudwatch.Alarm(this, 'SearchHitAlarm', {
      alarmName: `${projectName}-${environment}-zero-search-hits`,
      alarmDescription: 'Multiple /ask queries returning zero search results — possible indexing failure',
      metric: new cloudwatch.MathExpression({
        expression: 'IF(queries >= 3 AND totalHits == 0, 1, 0)',
        usingMetrics: {
          totalHits: new cloudwatch.Metric({
            namespace: projectName,
            metricName: 'SearchHitCount',
            statistic: 'Sum',
            period: cdk.Duration.minutes(10),
          }),
          queries: new cloudwatch.Metric({
            namespace: projectName,
            metricName: 'SearchHitCount',
            statistic: 'SampleCount',
            period: cdk.Duration.minutes(10),
          }),
        },
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    searchHitAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    const hybridFallbackAlarm = new cloudwatch.Alarm(this, 'HybridSearchFallbackAlarm', {
      alarmName: `${projectName}-${environment}-hybrid-search-fallback`,
      alarmDescription: 'Semantic retrieval degraded to BM25-only search',
      metric: new cloudwatch.Metric({
        namespace: projectName,
        metricName: 'HybridSearchFallback',
        dimensionsMap: {
          Environment: environment,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    hybridFallbackAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // ── Cost Guardrails ───────────────────────────────────────────
    //
    // This stack has a hard monthly floor even at zero traffic — OpenSearch
    // Serverless OCUs never scale to zero (~$175/mo in dev), plus provisioned
    // concurrency, a KMS CMK, a secret, and this dashboard. Measured floor at
    // audit time was ~$207/mo to hold 3.6 KB of notes.
    //
    // Two independent tripwires, because they fail differently: the Budget is
    // forecast-aware but coarse (~8h refresh), while the CloudWatch billing
    // alarm is near-real-time. See docs/AUDIT-2026-08.md finding 13.

    const monthlyBudgetUsd = environment === 'prod' ? 500 : 250;

    // AWS Budgets publishes as budgets.amazonaws.com, which is NOT covered by
    // the default topic policy. Without this grant the budget is created
    // successfully but every notification is silently dropped — a guardrail
    // that looks armed and is not.
    this.alarmTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['SNS:Publish'],
        resources: [this.alarmTopic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: `${projectName}-monthly-${environment}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:Project$${projectName}`] },
      },
      notificationsWithSubscribers: [
        // Actual spend crossed 80% of budget.
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alarmTopic.topicArn }],
        },
        // Forecast says we will exceed the budget this month.
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alarmTopic.topicArn }],
        },
      ],
    });

    // AWS/Billing metrics are only published in us-east-1, so this alarm is
    // only meaningful when the stack is deployed there. Guarded to avoid
    // creating an alarm that sits in INSUFFICIENT_DATA forever.
    if (this.region === 'us-east-1') {
      const billingAlarm = new cloudwatch.Alarm(this, 'EstimatedChargesAlarm', {
        alarmName: `${projectName}-estimated-charges-${environment}`,
        alarmDescription:
          `Total estimated AWS charges exceeded $${monthlyBudgetUsd}. ` +
          'Largest fixed cost is the OpenSearch Serverless OCU floor.',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Billing',
          metricName: 'EstimatedCharges',
          dimensionsMap: { Currency: 'USD' },
          statistic: 'Maximum',
          period: cdk.Duration.hours(6),
        }),
        threshold: monthlyBudgetUsd,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      billingAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    }

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
