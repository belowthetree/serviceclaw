# Service Performance

This document describes the performance characteristics and benchmarks for the OpenClaw Service system.

## Performance Criteria

The Service system is designed to meet the following performance criteria:

| Metric              | Target       | Description                                                      |
| ------------------- | ------------ | ---------------------------------------------------------------- |
| Installation Time   | < 30 seconds | Time to install a single service                                 |
| Startup Time        | < 5 seconds  | Time to enable/start a service                                   |
| Concurrent Services | 10           | Number of services that can run concurrently without degradation |
| Memory per Service  | < 5 MB       | Memory overhead per installed service                            |

## Benchmarks

### Installation Performance

Service installation involves multiple phases:

1. **Validation** - Validates the service manifest and configuration
2. **Preparation** - Creates agent sessions and validates permissions
3. **Resource Creation** - Sets up triggers (cron, webhook, message)
4. **Commit** - Finalizes installation

**Measured Performance:**

- Cron trigger service: ~50-200ms
- Webhook trigger service: ~30-150ms
- Message trigger service: ~40-180ms

All installation times are well under the 30-second target.

### Startup Performance

Service startup (enable operation) performance:

- **Enable operation**: ~5-20ms
- **Disable operation**: ~2-10ms
- **Full startup** (install + enable): ~100-500ms

All startup times are well under the 5-second target.

### Concurrent Service Performance

The system is tested with 10 concurrent services:

- **Concurrent installation**: Average < 100ms per service
- **Concurrent enable**: Total < 10 seconds for all 10 services
- **No degradation**: Performance remains consistent under load

### Memory Usage

Memory overhead per service:

- **Heap usage**: ~100-500 KB per service
- **RSS**: ~200-800 KB per service
- **Memory scaling**: Linear with number of services

Memory is released when services are uninstalled.

## Running Performance Tests

### Run All Performance Tests

```bash
pnpm test src/services/performance.test.ts
```

### Run Specific Test Suites

```bash
# Installation performance only
pnpm test src/services/performance.test.ts -- --grep "Installation Performance"

# Startup performance only
pnpm test src/services/performance.test.ts -- --grep "Startup Performance"

# Concurrent service tests
pnpm test src/services/performance.test.ts -- --grep "Concurrent Service Performance"

# Memory usage tests
pnpm test src/services/performance.test.ts -- --grep "Memory Usage"
```

### Run with Verbose Output

```bash
pnpm test src/services/performance.test.ts -- --reporter=verbose
```

## Test Implementation Details

### Performance Constants

The tests use the following performance thresholds:

```typescript
const MAX_INSTALL_TIME_MS = 30_000; // 30 seconds
const MAX_STARTUP_TIME_MS = 5_000; // 5 seconds
const CONCURRENT_SERVICE_COUNT = 10; // 10 services
const MAX_MEMORY_PER_SERVICE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_OPERATION_TIME_MS = 1_000; // 1 second
```

### Measurement Utilities

The test suite provides utilities for:

- **Time measurement**: `measureTime()` and `measureTimeSync()`
- **Memory profiling**: `getMemoryUsage()` and `calculateMemoryDelta()`
- **Garbage collection**: `forceGarbageCollection()` (when available)

### Test Coverage

The performance tests cover:

1. **Single Service Installation**
   - Cron, webhook, and message trigger types
   - Memory usage during installation
   - Installation phase timing

2. **Startup Performance**
   - Enable/disable operations
   - Full startup sequence
   - Multiple start/stop cycles

3. **Concurrent Operations**
   - Concurrent installation of 10 services
   - Mixed trigger types concurrently
   - Concurrent enable/disable operations

4. **Memory Usage**
   - Per-service memory overhead
   - Memory release on uninstall
   - Linear scaling verification
   - Runtime stability

5. **Stress Tests**
   - Rapid lifecycle operations
   - Bulk operations
   - Large configuration handling

## Optimization Guidelines

### For Service Developers

1. **Keep configurations small** - Large configs increase memory usage
2. **Use appropriate triggers** - Choose the simplest trigger type for your use case
3. **Minimize dependencies** - Fewer required skills/tools reduce startup time
4. **Test performance** - Run the performance tests with your service

### For System Operators

1. **Monitor memory usage** - Use the memory profiling utilities
2. **Batch operations** - Use bulk enable/disable when managing many services
3. **Regular cleanup** - Uninstall unused services to free memory
4. **Performance testing** - Run tests after system changes

## Troubleshooting Performance Issues

### Slow Installation

- Check CronService availability
- Verify webhook path uniqueness
- Review message trigger filter complexity

### High Memory Usage

- Review service configurations for large objects
- Check for memory leaks in custom triggers
- Ensure proper cleanup on uninstall

### Concurrent Performance Degradation

- Verify system resources (CPU, memory)
- Check for blocking operations in triggers
- Review concurrent test results for patterns

## Future Improvements

Potential areas for performance optimization:

1. **Parallel validation** - Validate multiple services concurrently
2. **Lazy initialization** - Defer resource creation until first use
3. **Connection pooling** - Share connections between services
4. **Caching** - Cache validation results for repeated operations

## See Also

- [Service Lifecycle](/services/lifecycle.md) - Service state management
- [Service Architecture](/services/architecture.md) - System design
- [Installation Testing](/services/installation-testing.md) - Installation verification
