#import "GossipService.h"

@implementation GossipService {
    BOOL _initialized;
}

- (void)initialize {
    _initialized = YES;
}

- (void)configure:(NSDictionary*)config {
    // Config implementation
}

- (NSDictionary*)getPeers {
    return @{@"count": @0, @"peers": @[]};
}

- (NSString*)broadcast:(NSString*)type payload:(NSDictionary*)payload {
    return [[NSUUID UUID] UUIDString];
}

- (NSDictionary*)getStats {
    return @{@"running": @YES, @"peers": @0};
}

- (void)shutdown {
    _initialized = NO;
}

@end
