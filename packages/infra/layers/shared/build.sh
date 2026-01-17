#!/bin/bash

# Build script for Lambda layer

set -e

echo "Building Lambda shared layer..."

# Clean previous build
rm -rf nodejs/node_modules
rm -f layer.zip

# Install dependencies
cd nodejs
npm install --production

# Copy shared package build output
cp -r ../../../../shared/dist/* node_modules/@ultrathink/shared/

# Remove unnecessary files to reduce layer size
find node_modules -name "*.md" -delete
find node_modules -name "*.txt" -delete
find node_modules -name "*.yml" -delete
find node_modules -name "*.yaml" -delete
find node_modules -name ".*.yml" -delete
find node_modules -name "LICENSE*" -delete
find node_modules -name "CHANGELOG*" -delete
find node_modules -name "README*" -delete
find node_modules -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "__tests__" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "*.test.js" -delete
find node_modules -name "*.spec.js" -delete

cd ..

# Create zip file for layer
zip -rq layer.zip nodejs/

echo "Lambda layer built successfully: layer.zip"
echo "Size: $(du -h layer.zip | cut -f1)"