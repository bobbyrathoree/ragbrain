/**
 * Playwright script to simulate an AWS SDE capturing thoughts throughout their workday.
 * This populates the ragbrain database with realistic engineering thoughts.
 */

import { chromium } from 'playwright';

const API_URL = process.env.API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
const API_KEY = process.env.API_KEY || '';

// Realistic thoughts from an AWS SDE's workday
const SDE_THOUGHTS = [
  // Morning standup & planning
  { text: "Sprint planning: Need to finish the Lambda cold start optimization by Friday. Current P99 is 800ms, target is under 200ms.", type: "decision", tags: ["lambda", "performance", "sprint"] },
  { text: "Team standup - blocked on IAM permissions for the new S3 bucket. Waiting on security review.", type: "note", tags: ["standup", "blocked"] },
  { text: "TODO: Review Sarah's PR for the DynamoDB GSI changes. She mentioned some concerns about read capacity.", type: "todo", tags: ["code-review", "dynamodb"] },

  // Deep work - coding
  { text: "Figured out the Lambda memory issue! We were loading the entire SDK at cold start. Switched to modular imports and cut memory by 40%.", type: "insight", tags: ["lambda", "optimization", "aws-sdk"] },
  { text: "const client = new DynamoDBClient({ region }); // Only import what you need, not the whole SDK", type: "code", tags: ["dynamodb", "best-practice"] },
  { text: "TIL: S3 Select can query data in-place without downloading the whole object. Perfect for our log analysis use case.", type: "insight", tags: ["s3", "til"] },
  { text: "Bug investigation: The intermittent 503s are caused by Lambda concurrency limits. We're hitting the 1000 concurrent execution limit during traffic spikes.", type: "note", tags: ["debugging", "lambda", "scaling"] },

  // Architecture decisions
  { text: "Decision: Going with Step Functions over SQS for the order processing workflow. We need the visibility into execution state and the built-in retry logic.", type: "decision", tags: ["architecture", "step-functions", "design"] },
  { text: "Considered EventBridge vs SNS for the event bus. EventBridge wins - content-based filtering and schema registry are killer features.", type: "decision", tags: ["architecture", "eventbridge", "events"] },
  { text: "API Gateway vs ALB for the new microservice: Choosing API Gateway for the native Lambda integration and request validation.", type: "decision", tags: ["api-gateway", "architecture"] },

  // Code reviews
  { text: "PR feedback: The retry logic should use exponential backoff with jitter. Current implementation will cause thundering herd.", type: "note", tags: ["code-review", "resilience"] },
  { text: "Good pattern from Maria's PR: Using AWS X-Ray segments to trace cross-service calls. Adding this to our observability standards.", type: "insight", tags: ["x-ray", "observability", "best-practice"] },

  // Learning & research
  { text: "https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html - Provisioned concurrency could solve our cold start issue but need to calculate cost", type: "link", tags: ["lambda", "research"] },
  { text: "Reading about AWS Lambda SnapStart for Java - up to 90% reduction in cold starts. We should evaluate this for the payment service.", type: "note", tags: ["lambda", "snapstart", "research"] },
  { text: "Interesting: CloudWatch Contributor Insights can automatically detect top-N contributors to metrics. Would help with our high-cardinality debugging.", type: "insight", tags: ["cloudwatch", "observability"] },

  // Debugging sessions
  { text: "Root cause found: The timeout was happening because we weren't closing the HTTP connection pool. Lambda was reusing stale connections.", type: "insight", tags: ["debugging", "lambda", "http"] },
  { text: "CloudWatch Logs Insights query that saved my day:\nfields @timestamp, @message | filter @message like /ERROR/ | stats count() by bin(5m)", type: "code", tags: ["cloudwatch", "debugging", "logs"] },
  { text: "The DynamoDB throttling was caused by hot partition. Our user_id partition key has uneven distribution - power users hit the same partition.", type: "insight", tags: ["dynamodb", "scaling", "debugging"] },

  // Infrastructure & DevOps
  { text: "TODO: Set up CloudWatch alarms for Lambda concurrent executions before we hit the limit again.", type: "todo", tags: ["monitoring", "lambda", "ops"] },
  { text: "CDK tip: Use removal policies carefully. RemovalPolicy.DESTROY on S3 buckets in prod is a disaster waiting to happen.", type: "insight", tags: ["cdk", "infrastructure", "best-practice"] },
  { text: "Migrating from CloudFormation to CDK. The type safety and ability to write actual code for infrastructure is a game changer.", type: "note", tags: ["cdk", "infrastructure"] },

  // Security
  { text: "Security review feedback: Need to enable S3 bucket encryption at rest and in transit. Adding KMS key rotation.", type: "note", tags: ["security", "s3", "encryption"] },
  { text: "Implemented least-privilege IAM for the Lambda: only dynamodb:Query and dynamodb:GetItem on the specific table ARN.", type: "decision", tags: ["security", "iam", "lambda"] },
  { text: "TODO: Rotate the API keys in Secrets Manager. Set up automatic rotation with a Lambda function.", type: "todo", tags: ["security", "secrets-manager"] },

  // Performance optimization
  { text: "Benchmark results: Switching from JSON to Protocol Buffers reduced payload size by 60% and parsing time by 75%.", type: "insight", tags: ["performance", "optimization"] },
  { text: "Added DAX (DynamoDB Accelerator) for the product catalog. Read latency dropped from 5ms to 0.5ms.", type: "decision", tags: ["dynamodb", "dax", "caching"] },
  { text: "Connection pooling in Lambda: Keep connections alive between invocations by initializing outside the handler.", type: "insight", tags: ["lambda", "performance", "best-practice"] },

  // Team collaboration
  { text: "Design review with the team: Agreed on using API Gateway REST APIs (not HTTP APIs) for the WebSocket support we'll need later.", type: "note", tags: ["meeting", "api-gateway", "design"] },
  { text: "Onboarding doc: Created runbook for common Lambda debugging scenarios. New hires keep hitting the same issues.", type: "note", tags: ["documentation", "onboarding"] },
  { text: "Retro action item: Add integration tests for the event-driven flows. Too many bugs slipping through unit tests.", type: "decision", tags: ["testing", "retro", "quality"] },

  // Cost optimization
  { text: "Cost analysis: Moving from provisioned to on-demand DynamoDB capacity could save $2k/month given our traffic patterns.", type: "insight", tags: ["cost", "dynamodb"] },
  { text: "S3 Intelligent-Tiering is saving us 40% on storage costs for infrequently accessed data. Worth the small monitoring fee.", type: "insight", tags: ["s3", "cost", "optimization"] },
  { text: "Reserved capacity for Lambda: Doesn't exist! But Savings Plans cover Lambda. Need to evaluate our commitment level.", type: "note", tags: ["cost", "lambda", "savings-plans"] },

  // End of day reflections
  { text: "Good progress today: Fixed the cold start issue, reviewed 3 PRs, and documented the new retry patterns.", type: "note", tags: ["reflection", "progress"] },
  { text: "Tomorrow: Focus on the Step Functions implementation. Need to handle the compensation logic for failed transactions.", type: "todo", tags: ["planning", "step-functions"] },
  { text: "Learned that CloudWatch Logs has a 256KB event size limit. Our stack traces were being truncated. Need to implement log aggregation.", type: "insight", tags: ["cloudwatch", "logging", "til"] },

  // More technical deep dives
  { text: "Lambda Layers are great for sharing code but watch out - they increase cold start time proportionally to layer size.", type: "insight", tags: ["lambda", "layers", "performance"] },
  { text: "EventBridge rule pattern for filtering: { \"source\": [\"com.myapp\"], \"detail-type\": [\"OrderPlaced\"], \"detail\": { \"amount\": [{ \"numeric\": [\">\", 100] }] }}", type: "code", tags: ["eventbridge", "patterns"] },
  { text: "SQS FIFO queues guarantee ordering but have a 300 TPS limit per message group. Need to shard by order_id for higher throughput.", type: "insight", tags: ["sqs", "fifo", "scaling"] },

  // Operational incidents
  { text: "Postmortem: Last week's outage was caused by a misconfigured security group. Added automated checks for common misconfigurations.", type: "note", tags: ["postmortem", "security", "automation"] },
  { text: "Runbook updated: Added steps for rolling back Lambda deployments using traffic shifting.", type: "note", tags: ["runbook", "deployment", "lambda"] },
  { text: "Alert fatigue is real. Consolidated 15 low-priority alarms into a single daily digest.", type: "decision", tags: ["monitoring", "alerts", "ops"] },

  // API design
  { text: "REST API versioning decision: Using URL path versioning (/v1/users) instead of headers. More explicit and easier to route.", type: "decision", tags: ["api", "design", "versioning"] },
  { text: "Added request validation in API Gateway. Catches malformed requests before they hit Lambda - saves compute and improves error messages.", type: "insight", tags: ["api-gateway", "validation", "optimization"] },
  { text: "GraphQL vs REST for the new service: Going with REST. Our use case is simple CRUD without complex relational queries.", type: "decision", tags: ["api", "graphql", "rest", "architecture"] },

  // Testing strategies
  { text: "LocalStack is amazing for local AWS development. Running full integration tests without deploying to AWS.", type: "insight", tags: ["testing", "localstack", "development"] },
  { text: "Contract testing with Pact for service boundaries. Catches breaking changes before they reach production.", type: "note", tags: ["testing", "contracts", "microservices"] },
  { text: "Load testing results: The API handles 10k RPS with P99 under 100ms. Bottleneck is DynamoDB write capacity.", type: "note", tags: ["testing", "performance", "load-testing"] },

  // Microservices patterns
  { text: "Circuit breaker pattern: Using AWS App Mesh for service mesh. Built-in circuit breaking and retry policies.", type: "note", tags: ["microservices", "resilience", "app-mesh"] },
  { text: "Saga pattern for distributed transactions: Each service publishes events, compensating transactions handle rollbacks.", type: "insight", tags: ["saga", "transactions", "events"] },
  { text: "Service discovery with Cloud Map. Services register themselves, consumers look up by namespace.", type: "note", tags: ["service-discovery", "cloud-map", "microservices"] },
];

async function captureThought(thought: typeof SDE_THOUGHTS[0]) {
  const response = await fetch(`${API_URL}/thoughts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      text: thought.text,
      type: thought.type,
      tags: thought.tags,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to capture thought: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Starting thought population...');
  console.log(`API URL: ${API_URL}`);
  console.log(`Total thoughts to capture: ${SDE_THOUGHTS.length}\n`);

  if (!API_KEY) {
    console.error('❌ API_KEY environment variable is required');
    process.exit(1);
  }

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < SDE_THOUGHTS.length; i++) {
    const thought = SDE_THOUGHTS[i];
    try {
      await captureThought(thought);
      successful++;
      const preview = thought.text.substring(0, 50) + (thought.text.length > 50 ? '...' : '');
      console.log(`✓ [${i + 1}/${SDE_THOUGHTS.length}] ${preview}`);

      // Small delay to avoid rate limiting and allow indexing
      await sleep(500);
    } catch (error) {
      failed++;
      console.error(`✗ [${i + 1}/${SDE_THOUGHTS.length}] Failed: ${error}`);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`\n✨ Done! Wait a few seconds for indexing to complete.`);
}

main().catch(console.error);
