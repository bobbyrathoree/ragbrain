/**
 * Shared CloudWatch metrics helper.
 * Replaces the ~20-line PutMetricDataCommand boilerplate
 * that was copy-pasted in every Lambda handler.
 */
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

type MetricUnit = 'Milliseconds' | 'Count' | 'Bytes' | 'None';

interface MetricEntry {
  name: string;
  value: number;
  unit?: MetricUnit;
  dimensions?: Record<string, string>;
}

export async function emitMetrics(
  cloudwatch: CloudWatchClient,
  metrics: MetricEntry[],
): Promise<void> {
  const namespace = process.env.PROJECT_NAME;
  const environment = process.env.ENVIRONMENT;

  if (!namespace) return;

  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: namespace,
    MetricData: metrics.map(m => ({
      MetricName: m.name,
      Value: m.value,
      Unit: m.unit || 'Count',
      Dimensions: [
        { Name: 'Environment', Value: environment || 'unknown' },
        ...Object.entries(m.dimensions || {}).map(([k, v]) => ({ Name: k, Value: v })),
      ],
    })),
  })).catch(err => {
    console.error('Failed to emit metrics:', err);
  });
}
