#import "WiFiBillingService.h"

@implementation WiFiBillingService {
    NSMutableDictionary* _activeSession;
    BOOL _initialized;
}

- (void)initialize {
    _initialized = YES;
    _activeSession = nil;
}

- (void)configure:(NSDictionary*)config {
    // Config implementation
}

- (void)startBillingSession:(NSDictionary*)options {
    _activeSession = [NSMutableDictionary dictionaryWithDictionary:options];
    _activeSession[@"sessionId"] = [[NSUUID UUID] UUIDString];
    _activeSession[@"startTime"] = @([[NSDate date] timeIntervalSince1970]);
}

- (NSDictionary*)endBillingSession:(NSString*)ssid {
    NSDictionary* result = @{@"finalCost": @10.0};
    _activeSession = nil;
    return result;
}

- (NSDictionary*)getActiveSession {
    return _activeSession;
}

- (NSDictionary*)pauseSession:(NSString*)reason {
    return @{@"paused": @YES};
}

- (NSDictionary*)resumeSession {
    return @{@"resumed": @YES};
}

- (NSDictionary*)getConnectionInfo {
    return @{@"connected": @YES};
}

- (void)shutdown {
    _initialized = NO;
}

@end
