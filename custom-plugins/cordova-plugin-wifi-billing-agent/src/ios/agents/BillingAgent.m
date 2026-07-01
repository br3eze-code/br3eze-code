//
//  BillingAgent.m
//  WiFi Billing Agent
//

#import "BillingAgent.h"
#import "CoreAgent.h"

@interface BillingSession : NSObject
@property (nonatomic, strong) NSString *sessionId;
@property (nonatomic, strong) NSString *connectionId;
@property (nonatomic, strong) NSString *ssid;
@property (nonatomic, strong) NSString *userId;
@property (nonatomic, strong) NSString *planId;
@property (nonatomic, assign) NSTimeInterval startTime;
@property (nonatomic, assign) NSTimeInterval timeLimit;
@property (nonatomic, assign) long long dataLimit;
@property (nonatomic, assign) double rate;
@property (nonatomic, strong) NSString *state; // active, paused, ended
@property (nonatomic, assign) long long startBytes;
@property (nonatomic, assign) long long dataUsedBeforePause;
@property (nonatomic, assign) NSTimeInterval pauseTime;
@property (nonatomic, assign) NSTimeInterval totalPaused;
@property (nonatomic, assign) double finalCost;
@end

@implementation BillingSession
@end

@interface BillingAgent()

@property (nonatomic, strong) NSMutableDictionary<NSString *, BillingSession *> *activeSessions;
@property (nonatomic, strong) NSTimer *billingTimer;
@property (nonatomic, assign) NSTimeInterval billingInterval;
@property (nonatomic, assign) NSTimeInterval gracePeriod;

@end

@implementation BillingAgent

- (instancetype)initWithConfig:(NSDictionary *)config {
    self = [super init];
    if (self) {
        _currency = config[@"currency"] ?: @"USD";
        _defaultRate = [config[@"defaultRate"] doubleValue] ?: 0.10;
        _billingInterval = [config[@"billingInterval"] doubleValue] ?: 60.0;
        _gracePeriod = [config[@"gracePeriod"] doubleValue] ?: 30.0;
        _activeSessions = [[NSMutableDictionary alloc] init];
    }
    return self;
}

- (void)initialize {
    NSLog(@"[BillingAgent] Initializing");
    [self startBillingCycle];
}

- (void)shutdown {
    NSLog(@"[BillingAgent] Shutting down");
    [self.billingTimer invalidate];
    
    // End all active sessions
    for (NSString *sessionId in self.activeSessions.allKeys) {
        [self endSession:sessionId reason:@"agent_shutdown"];
    }
}

- (NSDictionary *)startSession:(NSString *)connectionId 
                          ssid:(NSString *)ssid 
                        userId:(NSString *)userId 
                        planId:(NSString *)planId 
                     timeLimit:(NSInteger)timeLimit 
                     dataLimit:(long long)dataLimit {
    
    NSString *sessionId = [NSString stringWithFormat:@"pc-sess-%.0f-%u", 
        [[NSDate date] timeIntervalSince1970] * 1000,
        arc4random_uniform(100000)];
    
    BillingSession *session = [[BillingSession alloc] init];
    session.sessionId = sessionId;
    session.connectionId = connectionId;
    session.ssid = ssid;
    session.userId = userId;
    session.planId = planId ?: @"default";
    session.startTime = [[NSDate date] timeIntervalSince1970] * 1000;
    session.timeLimit = timeLimit * 60 * 1000; // Convert to ms
    session.dataLimit = dataLimit;
    session.rate = self.defaultRate;
    session.state = @"active";
    session.startBytes = 0; // Would get from network interface
    session.totalPaused = 0;
    
    self.activeSessions[sessionId] = session;
    
    // Show local notification
    [self showSessionNotification:session];
    
    NSLog(@"[BillingAgent] Started session: %@ for SSID: %@", sessionId, ssid);
    
    return @{
        @"sessionId": sessionId,
        @"ssid": ssid,
        @"startTime": @(session.startTime),
        @"state": @"active",
        @"currency": self.currency,
        @"rate": @(session.rate)
    };
}

- (NSDictionary *)endSession:(NSString *)sessionId reason:(NSString *)reason {
    BillingSession *session = self.activeSessions[sessionId];
    if (!session) {
        return @{@"error": @"Session not found"};
    }
    
    // Calculate final usage
    NSTimeInterval elapsed = ([[NSDate date] timeIntervalSince1970] * 1000) - session.startTime - session.totalPaused;
    double cost = (elapsed / 1000.0 / 60.0) * session.rate;
    
    session.state = @"ended";
    session.finalCost = cost;
    
    // Clear notification
    [[NSNotificationCenter defaultCenter] postNotificationName:@"ClearBillingNotification" object:nil];
    
    NSDictionary *result = @{
        @"sessionId": sessionId,
        @"duration": @(elapsed / 1000 / 60),
        @"finalCost": @(cost),
        @"currency": self.currency,
        @"reason": reason
    };
    
    [self.activeSessions removeObjectForKey:sessionId];
    
    NSLog(@"[BillingAgent] Ended session: %@, Cost: $%.2f", sessionId, cost);
    
    return result;
}

- (NSDictionary *)pauseSession:(NSString *)sessionId reason:(NSString *)reason {
    BillingSession *session = self.activeSessions[sessionId];
    if (!session || ![session.state isEqualToString:@"active"]) {
        return @{@"error": @"Cannot pause inactive session"};
    }
    
    session.state = @"paused";
    session.pauseTime = [[NSDate date] timeIntervalSince1970] * 1000;
    session.dataUsedBeforePause = 0; // Would calculate from network stats
    
    return @{
        @"sessionId": sessionId,
        @"state": @"paused",
        @"reason": reason,
        @"pauseTime": @(session.pauseTime)
    };
}

- (NSDictionary *)resumeSession:(NSString *)sessionId {
    BillingSession *session = self.activeSessions[sessionId];
    if (!session || ![session.state isEqualToString:@"paused"]) {
        return @{@"error": @"Cannot resume non-paused session"};
    }
    
    NSTimeInterval pausedDuration = ([[NSDate date] timeIntervalSince1970] * 1000) - session.pauseTime;
    session.totalPaused += pausedDuration;
    session.state = @"active";
    
    return @{
        @"sessionId": sessionId,
        @"state": @"active",
        @"pausedDuration": @(pausedDuration)
    };
}

- (NSDictionary *)getSessionStatus:(NSString *)sessionId {
    BillingSession *session = self.activeSessions[sessionId];
    if (!session) {
        return @{@"active": @(NO)};
    }
    
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    NSTimeInterval elapsed = now - session.startTime - session.totalPaused;
    NSTimeInterval remaining = session.timeLimit - elapsed;
    
    // Calculate data usage (simplified)
    long long dataUsed = 0; // Would get from network interface
    
    double currentCost = (elapsed / 1000.0 / 60.0) * session.rate;
    
    return @{
        @"active": @(YES),
        @"sessionId": sessionId,
        @"state": session.state,
        @"ssid": session.ssid,
        @"elapsedMinutes": @(elapsed / 1000 / 60),
        @"remainingMinutes": @(MAX(0, remaining / 1000 / 60)),
        @"dataUsed": @(dataUsed),
        @"dataUsedMB": @(dataUsed / (1024 * 1024)),
        @"currentCost": @(currentCost),
        @"currency": self.currency
    };
}

- (NSDictionary *)getDataUsage:(NSString *)sessionId {
    BillingSession *session = self.activeSessions[sessionId];
    if (!session) {
        return @{@"active": @(NO)};
    }
    
    long long dataUsed = 0; // Would calculate from network stats
    
    return @{
        @"active": @(YES),
        @"sessionDataUsed": @(dataUsed),
        @"sessionDataUsedMB": @(dataUsed / (1024 * 1024)),
        @"dataLimitMB": @(session.dataLimit / (1024 * 1024)),
        @"percentageUsed": session.dataLimit > 0 ? @((dataUsed * 100) / session.dataLimit) : @(0)
    };
}

- (void)startBillingCycle {
    self.billingTimer = [NSTimer scheduledTimerWithTimeInterval:self.billingInterval
                                                         target:self
                                                       selector:@selector(updateSessions)
                                                       userInfo:nil
                                                        repeats:YES];
}

- (void)updateSessions {
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    
    for (BillingSession *session in self.activeSessions.allValues) {
        if (![session.state isEqualToString:@"active"]) continue;
        
        NSTimeInterval elapsed = now - session.startTime - session.totalPaused;
        NSTimeInterval remaining = session.timeLimit - elapsed;
        
        // Check time limit
        if (remaining <= 0) {
            [self handleTimeLimitReached:session];
        }
        
        // Check data limit
        if (session.dataLimit > 0 && 0 >= session.dataLimit) { // Simplified
            [self handleDataLimitReached:session];
        }
        
        // Low time warning
        if (remaining < 5 * 60 * 1000 && remaining > 4 * 60 * 1000) {
            [self.core emitEvent:@"billing:time_low" data:@{
                @"sessionId": session.sessionId,
                @"minutes": @(remaining / 1000 / 60)
            }];
        }
        
        // Update notification
        [self updateSessionNotification:session];
    }
}

- (void)handleTimeLimitReached:(BillingSession *)session {
    NSLog(@"[BillingAgent] Time limit reached for session: %@", session.sessionId);
    [self endSession:session.sessionId reason:@"time_limit_reached"];
    
    [self.core emitEvent:@"billing:time_limit_reached" data:@{
        @"sessionId": session.sessionId
    }];
}

- (void)handleDataLimitReached:(BillingSession *)session {
    NSLog(@"[BillingAgent] Data limit reached for session: %@", session.sessionId);
    [self endSession:session.sessionId reason:@"data_limit_reached"];
    
    [self.core emitEvent:@"billing:data_limit_reached" data:@{
        @"sessionId": session.sessionId
    }];
}

- (void)showSessionNotification:(BillingSession *)session {
    // Post notification for UI to show
    [[NSNotificationCenter defaultCenter] postNotificationName:@"ShowBillingNotification" 
                                                        object:nil 
                                                      userInfo:@{
                                                          @"title": @"WiFi Session Started",
                                                          @"body": [NSString stringWithFormat:@"Connected to %@", session.ssid]
                                                      }];
}

- (void)updateSessionNotification:(BillingSession *)session {
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    NSTimeInterval elapsed = now - session.startTime - session.totalPaused;
    NSTimeInterval remaining = session.timeLimit - elapsed;
    double cost = (elapsed / 1000.0 / 60.0) * session.rate;
    
    [[NSNotificationCenter defaultCenter] postNotificationName:@"UpdateBillingNotification"
                                                        object:nil
                                                      userInfo:@{
                                                          @"title": [NSString stringWithFormat:@"WiFi Billing: %@", session.ssid],
                                                          @"body": [NSString stringWithFormat:@"Time: %.0f min | Cost: $%.2f", remaining / 1000 / 60, cost]
                                                      }];
}

@end