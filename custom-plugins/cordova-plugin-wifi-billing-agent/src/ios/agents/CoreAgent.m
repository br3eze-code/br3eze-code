//
//  CoreAgent.m
//  WiFi Billing Agent
//

#import "CoreAgent.h"
#import "EventBus.h"
#import "StateManager.h"

@interface CoreAgent()

@property (nonatomic, strong, readwrite) NSString *agentId;
@property (nonatomic, strong, readwrite) NSString *nodeType;
@property (nonatomic, strong, readwrite) EventBus *eventBus;
@property (nonatomic, strong, readwrite) StateManager *stateManager;
@property (nonatomic, strong, readwrite) NSMutableDictionary *agents;
@property (nonatomic, assign, readwrite) NSTimeInterval startTime;
@property (nonatomic, strong) NSMutableDictionary *eventHandlers;

@end

@implementation CoreAgent

- (instancetype)initWithConfig:(NSDictionary *)config {
    self = [super init];
    if (self) {
        _agentId = config[@"agentId"] ?: [self generateAgentId];
        _nodeType = config[@"nodeType"] ?: @"mobile";
        _eventBus = [[EventBus alloc] init];
        _stateManager = [[StateManager alloc] init];
        _agents = [[NSMutableDictionary alloc] init];
        _eventHandlers = [[NSMutableDictionary alloc] init];
        _startTime = [[NSDate date] timeIntervalSince1970];
    }
    return self;
}

- (void)initialize {
    NSLog(@"[CoreAgent] Initializing %@", self.agentId);
    
    [self.stateManager initializeWithPersistence:YES encryption:YES sync:YES];
    
    // Setup default event handlers
    [self setupEventRouting];
}

- (NSString *)generateAgentId {
    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970] * 1000;
    u_int32_t random = arc4random_uniform(100000);
    return [NSString stringWithFormat:@"pc-agent-%.0f-%u", timestamp, random];
}

- (void)registerAgent:(NSString *)type agent:(id)agent {
    self.agents[type] = agent;
    
    // Inject dependencies
    if ([agent respondsToSelector:@selector(setCore:)]) {
        [agent setValue:self forKey:@"core"];
    }
    if ([agent respondsToSelector:@selector(setEventBus:)]) {
        [agent setValue:self.eventBus forKey:@"eventBus"];
    }
    if ([agent respondsToSelector:@selector(setStateManager:)]) {
        [agent setValue:self.stateManager forKey:@"stateManager"];
    }
    
    NSLog(@"[CoreAgent] Registered agent: %@", type);
}

- (id)getAgent:(NSString *)type {
    return self.agents[type];
}

- (void)setupEventRouting {
    __weak typeof(self) weakSelf = self;
    
    [self.eventBus on:@"system:critical" handler:^(NSDictionary *data) {
        [weakSelf handleCriticalEvent:data];
    }];
    
    [self.eventBus on:@"agent:failure" handler:^(NSDictionary *data) {
        [weakSelf handleAgentFailure:data];
    }];
}

- (void)handleCriticalEvent:(NSDictionary *)data {
    NSLog(@"[CoreAgent] Critical event: %@", data);
    
    // Notify all agents
    for (id agent in self.agents.allValues) {
        if ([agent respondsToSelector:@selector(handleCritical:)]) {
            [agent handleCritical:data];
        }
    }
}

- (void)handleAgentFailure:(NSDictionary *)data {
    NSString *agentType = data[@"agentType"];
    NSLog(@"[CoreAgent] Agent %@ failed: %@", agentType, data[@"error"]);
    
    // Auto-restart if configured
    id agent = self.agents[agentType];
    if ([agent respondsToSelector:@selector(shouldAutoRestart)] &&
        [agent shouldAutoRestart]) {
        // Restart logic
    }
}

- (NSDictionary *)processIntent:(NSString *)input context:(NSDictionary *)context {
    NSString *lowerInput = [input lowercaseString];
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    
    // Simple intent parsing - in production, use CoreML/NaturalLanguage
    if ([lowerInput containsString:@"connect"] || [lowerInput containsString:@"join"]) {
        result[@"intent"] = @"wifi_connect";
        result[@"confidence"] = @(0.9);
        result[@"requiresConfirmation"] = @(NO);
        
        NSMutableDictionary *actions = [NSMutableDictionary dictionary];
        actions[@"agent"] = @"wifi";
        actions[@"method"] = @"connect";
        result[@"actions"] = actions;
        
    } else if ([lowerInput containsString:@"disconnect"] || [lowerInput containsString:@"leave"]) {
        result[@"intent"] = @"wifi_disconnect";
        result[@"confidence"] = @(0.95);
        result[@"requiresConfirmation"] = @(YES);
        
        NSMutableDictionary *actions = [NSMutableDictionary dictionary];
        actions[@"agent"] = @"wifi";
        actions[@"method"] = @"disconnect";
        result[@"actions"] = actions;
        
    } else if ([lowerInput containsString:@"status"] || [lowerInput containsString:@"info"]) {
        result[@"intent"] = @"get_status";
        result[@"confidence"] = @(0.8);
        result[@"requiresConfirmation"] = @(NO);
        
    } else {
        result[@"intent"] = @"unknown";
        result[@"confidence"] = @(0.0);
        result[@"actions"] = [NSNull null];
    }
    
    result[@"autonomyLevel"] = @"assisted";
    
    return result;
}

- (void)emitEvent:(NSString *)event data:(NSDictionary *)data {
    NSMutableDictionary *eventData = [data mutableCopy] ?: [NSMutableDictionary dictionary];
    eventData[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);
    eventData[@"source"] = @"core";
    
    [self.eventBus emit:event data:eventData];
}

- (void)registerEventListener:(NSString *)event handler:(void (^)(NSDictionary *))handler {
    if (!self.eventHandlers[event]) {
        self.eventHandlers[event] = [NSMutableArray array];
    }
    [self.eventHandlers[event] addObject:handler];
    
    [self.eventBus on:event handler:handler];
}

- (NSDictionary *)getStatus {
    return @{
        @"agentId": self.agentId,
        @"nodeType": self.nodeType,
        @"uptime": @([[NSDate date] timeIntervalSince1970] - self.startTime),
        @"registeredAgents": self.agents.allKeys,
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    };
}

- (void)shutdown {
    NSLog(@"[CoreAgent] Shutting down");
    
    for (id agent in self.agents.allValues) {
        if ([agent respondsToSelector:@selector(deactivate)]) {
            [agent deactivate];
        }
    }
    
    [self.stateManager close];
}

@end