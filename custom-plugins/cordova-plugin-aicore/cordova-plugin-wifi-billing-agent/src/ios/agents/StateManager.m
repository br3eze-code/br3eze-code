//
//  StateManager.m
//  WiFi Billing Agent
//

#import "StateManager.h"

@interface StateManager()

@property (nonatomic, strong) NSMutableDictionary *states;
@property (nonatomic, assign) BOOL usePersistence;
@property (nonatomic, assign) BOOL useEncryption;
@property (nonatomic, assign) BOOL useSync;

@end

@implementation StateManager

- (instancetype)init {
    self = [super init];
    if (self) {
        _states = [[NSMutableDictionary alloc] init];
    }
    return self;
}

- (void)initializeWithPersistence:(BOOL)persistence encryption:(BOOL)encryption sync:(BOOL)sync {
    self.usePersistence = persistence;
    self.useEncryption = encryption;
    self.useSync = sync;
    
    // Initialize Core Data or SQLite for persistence
    // Initialize crypto if needed
    // Initialize Firebase sync if needed
    
    NSLog(@"[StateManager] Initialized [persistence:%@, encryption:%@, sync:%@]",
          persistence ? @"YES" : @"NO",
          encryption ? @"YES" : @"NO",
          sync ? @"YES" : @"NO");
}

- (void)set:(NSString *)key value:(id)value options:(NSDictionary *)options {
    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970] * 1000;
    
    NSMutableDictionary *state = [@{
        @"key": key,
        @"data": value,
        @"timestamp": @(timestamp)
    } mutableCopy];
    
    if (options[@"metadata"]) {
        state[@"metadata"] = options[@"metadata"];
    }
    
    self.states[key] = state;
    
    // Persist if needed
    if (self.usePersistence) {
        [self persistState:state];
    }
    
    // Sync if needed
    if (self.useSync && [options[@"sync"] boolValue]) {
        [self syncState:state];
    }
}

- (id)get:(NSString *)key options:(NSDictionary *)options {
    NSDictionary *state = self.states[key];
    if (!state) {
        // Try to load from persistence
        if (self.usePersistence) {
            state = [self loadPersistedState:key];
            if (state) {
                self.states[key] = state;
            }
        }
    }
    
    if (!state) return nil;
    
    // Decrypt if needed
    id data = state[@"data"];
    
    return @{
        @"key": key,
        @"value": data,
        @"timestamp": state[@"timestamp"],
        @"metadata": state[@"metadata"] ?: @{}
    };
}

- (void)persistState:(NSDictionary *)state {
    // Use NSUserDefaults for simple persistence
    // Use Core Data for complex persistence
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    [defaults setObject:state forKey:[NSString stringWithFormat:@"wba_state_%@", state[@"key"]]];
    [defaults synchronize];
}

- (NSDictionary *)loadPersistedState:(NSString *)key {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    return [defaults objectForKey:[NSString stringWithFormat:@"wba_state_%@", key]];
}

- (void)syncState:(NSDictionary *)state {
    // Firebase sync implementation
    NSLog(@"[StateManager] Syncing state: %@", state[@"key"]);
}

- (void)close {
    if (self.usePersistence) {
        [[NSUserDefaults standardUserDefaults] synchronize];
    }
}

@end