#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from './stacks/storage-stack';
import { ApiStack } from './stacks/api-stack';
import { ComputeStack } from './stacks/compute-stack';
import { SearchStack } from './stacks/search-stack';
import { MonitoringStack } from './stacks/monitoring-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') || 'dev';
const project = 'ragbrain';

const stackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  tags: {
    Project: project,
    Environment: env,
    ManagedBy: 'CDK',
  },
};

// Storage resources (S3, DynamoDB, SQS)
const storageStack = new StorageStack(app, `${project}-storage-${env}`, {
  ...stackProps,
  projectName: project,
  environment: env,
});

// Search infrastructure (OpenSearch Serverless)
const searchStack = new SearchStack(app, `${project}-search-${env}`, {
  ...stackProps,
  projectName: project,
  environment: env,
});

// Lambda functions and layers
const computeStack = new ComputeStack(app, `${project}-compute-${env}`, {
  ...stackProps,
  projectName: project,
  environment: env,
  storageBucket: storageStack.storageBucket,
  thoughtsTable: storageStack.thoughtsTable,
  indexQueue: storageStack.indexQueue,
  searchCollection: searchStack.searchCollection,
  encryptionKey: storageStack.encryptionKey,
});

// API Gateway
const apiStack = new ApiStack(app, `${project}-api-${env}`, {
  ...stackProps,
  projectName: project,
  environment: env,
  captureLambda: computeStack.captureLambda,
  askLambda: computeStack.askLambda,
  thoughtsLambda: computeStack.thoughtsLambda,
  graphLambda: computeStack.graphLambda,
  conversationsLambda: computeStack.conversationsLambda,
  exportLambda: computeStack.exportLambda,
});

// Monitoring and alerting
const monitoringStack = new MonitoringStack(app, `${project}-monitoring-${env}`, {
  ...stackProps,
  projectName: project,
  environment: env,
  api: apiStack.api,
  lambdas: [
    computeStack.captureLambda,
    computeStack.indexerLambda,
    computeStack.askLambda,
    computeStack.conversationsLambda,
    computeStack.exportLambda,
  ],
  dlq: storageStack.dlq,
});

app.synth();