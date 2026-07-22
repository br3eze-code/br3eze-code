//
//  CoreAgent.h
//  WiFi Billing Agent
//
//  Core agent managing event bus, state, and agent lifecycle
//

#import <Foundation/Foundation.h>
#import <Cordova/CDV.h>

@class EventBus;
@class StateManager;

@interface CoreAgent : NSObject

@property(nonatomic, strong, readonly) NSString *agentId;
@property(nonatomic, strong, readonly) NSString *nodeType;
@property(nonatomic, strong, readonly) EventBus *eventBus;
@property(nonatomic, strong, readonly) StateManager *stateManager;
@property(nonatomic, strong, readonly) NSMutableDictionary *agents;
@property(nonatomic, assign, readonly) NSTimeInterval startTime;

- (instancetype)initWithConfig:(NSDictionary *)config;
- (void)initialize;
- (NSString *)generateAgentId;
- (void)registerAgent:(NSString *)type agent:(id)agent;
- (id)getAgent:(NSString *)type;
- (NSDictionary *)processIntent:(NSString *)input context:(NSDictionary *)context;
- (void)emitEvent:(NSString *)event data:(NSDictionary *)data;
- (void)registerEventListener:(NSString *)event handler:(void (^)(NSDictionary *))handler;
- (NSDictionary *)getStatus;
- (void)shutdown;

@end