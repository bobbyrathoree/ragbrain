/**
 * Shared AWS client factories.
 * Each Lambda creates clients at module scope (reused across warm invocations).
 * This module eliminates the 9-line OpenSearch setup duplicated in 4 handlers.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

export function createOpenSearchClient(): Client {
  const endpoint = process.env.SEARCH_ENDPOINT;
  if (!endpoint) throw new Error('SEARCH_ENDPOINT not set');

  return new Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION!,
      service: 'aoss',
      getCredentials: defaultProvider(),
    }),
    node: endpoint,
  });
}

export function createBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: process.env.AWS_REGION });
}

export function createCloudWatchClient(): CloudWatchClient {
  return new CloudWatchClient({});
}

export function createDynamoDBClient(): DynamoDBClient {
  return new DynamoDBClient({});
}

export function createSQSClient(): SQSClient {
  return new SQSClient({});
}

export function createS3Client(): S3Client {
  return new S3Client({});
}
