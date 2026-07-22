//
//  EventBus.m
//  WiFi Billing Agent
//

#import "EventBus.h"

@interface EventHandler : NSObject
@property (nonatomic, copy) void (^handler)(NSDictionary *);
@property (nonatomic, assign) NSInteger priority;
@property (nonatomic, assign) BOOL once;
@end

@implementation EventHandler
@end

@interface EventBus()

@property (nonatomic, strong) NSMutableDictionary<NSString *, NSMutableArray<EventHandler *> *> *listeners;
@property (nonatomic, strong) NSMutableArray<BOOL (^)(NSString *, NSDictionary *)> *middleware;
@property (nonatomic, assign) NSUInteger eventsEmitted;
@property (nonatomic, assign) NSUInteger eventsHandled;

@end

@implementation EventBus

- (instancetype)init {
    self = [super init];
    if (self) {
        _listeners = [[NSMutableDictionary alloc] init];
        _middleware = [[NSMutableArray alloc] init];
        _eventsEmitted = 0;
        _eventsHandled = 0;
    }
    return self;
}

- (void)on:(NSString *)event handler:(void (^)(NSDictionary *))handler {
    [self on:event handler:handler priority:5];
}

- (void)on:(NSString *)event handler:(void (^)(NSDictionary *))handler priority:(NSInteger)priority {
    if (!self.listeners[event]) {
        self.listeners[event] = [[NSMutableArray alloc] init];
    }
    
    EventHandler *wrapper = [[EventHandler alloc] init];
    wrapper.handler = handler;
    wrapper.priority = priority;
    wrapper.once = NO;
    
    // Insert based on priority (higher = earlier)
    NSMutableArray *handlers = self.listeners[event];
    NSUInteger insertIndex = handlers.count;
    for (NSUInteger i = 0; i < handlers.count; i++) {
        if (handlers[i].priority < priority) {
            insertIndex = i;
            break;
        }
    }
    [handlers insertObject:wrapper atIndex:insertIndex];
}

- (void)once:(NSString *)event handler:(void (^)(NSDictionary *))handler {
    if (!self.listeners[event]) {
        self.listeners[event] = [[NSMutableArray alloc] init];
    }
    
    EventHandler *wrapper = [[EventHandler alloc] init];
    wrapper.handler = handler;
    wrapper.priority = 5;
    wrapper.once = YES;
    
    [self.listeners[event] addObject:wrapper];
}

- (void)off:(NSString *)event handler:(void (^)(NSDictionary *))handler {
    NSMutableArray *handlers = self.listeners[event];
    if (!handlers) return;
    
    NSMutableArray *toRemove = [NSMutableArray array];
    for (EventHandler *wrapper in handlers) {
        // Compare handlers by pointer
        if (wrapper.handler == handler) {
            [toRemove addObject:wrapper];
        }
    }
    [handlers removeObjectsInArray:toRemove];
}

- (void)emit:(NSString *)event data:(NSDictionary *)data {
    self.eventsEmitted++;
    
    // Run middleware
    __block NSDictionary *processedData = data;
    for (BOOL (^mw)(NSString *, NSDictionary *) in self.middleware) {
        if (!mw(event, processedData)) {
            return; // Cancelled
        }
    }
    
    // Get handlers for this event and wildcard
    NSMutableArray *handlers = [self.listeners[event] mutableCopy] ?: [NSMutableArray array];
    NSArray *wildcardHandlers = self.listeners[@"*"] ?: @[];
    [handlers addObjectsFromArray:wildcardHandlers];
    
    // Execute handlers
    NSMutableArray *onceHandlers = [NSMutableArray array];
    
    for (EventHandler *wrapper in handlers) {
        @try {
            wrapper.handler(processedData);
            self.eventsHandled++;
            
            if (wrapper.once) {
                [onceHandlers addObject:wrapper];
            }
        } @catch (NSException *exception) {
            NSLog(@"[EventBus] Handler error for %@: %@", event, exception);
            [self emit:@"bus:error" data:@{
                @"event": event,
                @"error": exception.description,
                @"data": processedData ?: @{}
            }];
        }
    }
    
    // Remove once handlers
    for (EventHandler *wrapper in onceHandlers) {
        [self.listeners[event] removeObject:wrapper];
    }
}

- (void)use:(BOOL (^)(NSString *, NSDictionary *))middleware {
    [self.middleware addObject:middleware];
}

- (NSDictionary *)getMetrics {
    return @{
        @"eventsEmitted": @(self.eventsEmitted),
        @"eventsHandled": @(self.eventsHandled)
    };
}

@end