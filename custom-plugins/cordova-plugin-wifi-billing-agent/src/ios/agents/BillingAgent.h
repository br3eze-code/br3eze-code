//
//  BillingAgent.h
//  WiFi Billing Agent
//

#import <Foundation/Foundation.h>

@class CoreAgent;

@interface BillingAgent : NSObject

@property(nonatomic, weak) CoreAgent *core;
@property(nonatomic, strong, readonly) NSString *currency;
@property(nonatomic, assign, readonly) double defaultRate;

- (instancetype)initWithConfig:(NSDictionary *)config;
- (void)initialize;
- (void)shutdown;

- (NSDictionary *)startSession:(NSString *)connectionId
                          ssid:(NSString *)ssid
                        userId:(NSString *)userId
                        planId:(NSString *)planId
                     timeLimit:(NSInteger)timeLimit
                     dataLimit:(long long)dataLimit;

- (NSDictionary *)endSession:(NSString *)sessionId reason:(NSString *)reason;
- (NSDictionary *)pauseSession:(NSString *)sessionId reason:(NSString *)reason;
- (NSDictionary *)resumeSession:(NSString *)sessionId;
- (NSDictionary *)getSessionStatus:(NSString *)sessionId;
- (NSDictionary *)getDataUsage:(NSString *)sessionId;

@end