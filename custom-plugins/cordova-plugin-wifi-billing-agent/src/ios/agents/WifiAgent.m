//
//  WiFiAgent.m
//  WiFi Billing Agent
//

#import "WiFiAgent.h"
#import "CoreAgent.h"
#import <SystemConfiguration/CaptiveNetwork.h>

@interface WiFiAgent()

@property (nonatomic, strong) NSDictionary *config;
@property (nonatomic, strong) NSArray *preferredNetworks;
@property (nonatomic, assign) NSTimeInterval scanInterval;
@property (nonatomic, assign) NSInteger signalThreshold;
@property (nonatomic, strong) NSMutableArray *connectionHistory;
@property (nonatomic, strong) NSTimer *scanTimer;

@end

@implementation WiFiAgent

- (instancetype)initWithConfig:(NSDictionary *)config {
    self = [super init];
    if (self) {
        _config = config;
        _preferredNetworks = config[@"preferredNetworks"] ?: @[@"PC-", @"PowerConnect", @"Billing-WiFi"];
        _scanInterval = [config[@"scanInterval"] doubleValue] ?: 10.0;
        _signalThreshold = [config[@"signalThreshold"] integerValue] ?: -75;
        _autoReconnectEnabled = [config[@"autoReconnect"] boolValue] ?: YES;
        _connectionHistory = [[NSMutableArray alloc] init];
    }
    return self;
}

- (void)initialize {
    NSLog(@"[WiFiAgent] Initializing");
    
    // Setup NEHotspotConfiguration helper
    // Monitor reachability
}

- (void)activate {
    NSLog(@"[WiFiAgent] Activated");
    
    // Start periodic scan
    self.scanTimer = [NSTimer scheduledTimerWithTimeInterval:self.scanInterval
                                                      target:self
                                                    selector:@selector(periodicScan)
                                                    userInfo:nil
                                                     repeats:YES];
}

- (void)deactivate {
    NSLog(@"[WiFiAgent] Deactivated");
    
    [self.scanTimer invalidate];
    self.scanTimer = nil;
    
    // Disconnect if needed
    if (self.currentSSID) {
        [self disconnectWithOptions:@{@"reason": @"agent_deactivation"} completion:nil];
    }
}

- (void)connect:(NSString *)ssid 
       password:(NSString *)password 
      algorithm:(NSString *)algorithm 
       isHidden:(BOOL)isHidden 
       billingSession:(NSDictionary *)billingSession
       completion:(void (^)(NSDictionary *, NSError *))completion {
    
    if (@available(iOS 11.0, *)) {
        NEHotspotConfiguration *config = [[NEHotspotConfiguration alloc] 
            initWithSSID:ssid passphrase:password isWEP:NO];
        config.joinOnce = NO;
        
        [[NEHotspotConfigurationManager sharedManager] applyConfiguration:config 
            completionHandler:^(NSError * _Nullable error) {
            
            if (error) {
                if (completion) {
                    completion(nil, error);
                }
                return;
            }
            
            self.currentSSID = ssid;
            self.currentConnectionId = [[NSUUID UUID] UUIDString];
            
            NSDictionary *result = @{
                @"success": @(YES),
                @"ssid": ssid,
                @"connectionId": self.currentConnectionId,
                @"method": @"hotspot_config",
                @"billingActive": billingSession ? @(YES) : @(NO)
            };
            
            if (billingSession) {
                // Start billing session tracking
                [self startBillingTracking:billingSession];
            }
            
            if (completion) {
                completion(result, nil);
            }
            
            // Emit event
            [self.core emitEvent:@"wifi:connected" data:result];
        }];
    } else {
        NSError *error = [NSError errorWithDomain:@"WiFiAgent" 
                                             code:1001 
                                         userInfo:@{NSLocalizedDescriptionKey: @"iOS 11+ required"}];
        if (completion) {
            completion(nil, error);
        }
    }
}

- (void)disconnect:(void (^)(NSDictionary *, NSError *))completion {
    [self disconnectWithOptions:@{@"reason": @"user_request"} completion:completion];
}

- (void)disconnectWithOptions:(NSDictionary *)options completion:(void (^)(NSDictionary *, NSError *))completion {
    NSString *ssid = options[@"ssid"] ?: self.currentSSID;
    BOOL endSession = [options[@"endSession"] boolValue] ?: YES;
    NSString *reason = options[@"reason"] ?: @"user_request";
    
    if (@available(iOS 11.0, *)) {
        [[NEHotspotConfigurationManager sharedManager] removeConfigurationForSSID:ssid];
    }
    
    // Record in history
    if (self.currentSSID) {
        [self.connectionHistory addObject:@{
            @"ssid": self.currentSSID,
            @"connectedAt": @([[NSDate date] timeIntervalSince1970] * 1000 - 60000), // Approximate
            @"disconnectedAt": @([[NSDate date] timeIntervalSince1970] * 1000),
            @"reason": reason
        }];
    }
    
    NSDictionary *result = @{
        @"success": @(YES),
        @"ssid": ssid,
        @"sessionEnded": @(endSession)
    };
    
    self.currentSSID = nil;
    self.currentConnectionId = nil;
    
    if (completion) {
        completion(result, nil);
    }
    
    [self.core emitEvent:@"wifi:disconnected" data:@{@"ssid": ssid, @"reason": reason}];
}

- (NSDictionary *)getConnectionInfo {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    
    NSString *ssid = [self getCurrentSSID];
    
    if (ssid) {
        info[@"connected"] = @(YES);
        info[@"ssid"] = ssid;
        info[@"bssid"] = [self getCurrentBSSID] ?: [NSNull null];
        info[@"connectionId"] = self.currentConnectionId ?: [NSNull null];
        
        // Add billing info if available
        // This would come from the billing agent
    } else {
        info[@"connected"] = @(NO);
    }
    
    return info;
}

- (void)scanWithOptions:(NSDictionary *)options completion:(void (^)(NSArray *, NSError *))completion {
    // iOS doesn't allow direct WiFi scanning
    // Return current network info and known networks
    
    NSMutableArray *networks = [NSMutableArray array];
    
    NSString *currentSSID = [self getCurrentSSID];
    if (currentSSID) {
        [networks addObject:@{
            @"ssid": currentSSID,
            @"bssid": [self getCurrentBSSID] ?: @"",
            @"connected": @(YES),
            @"isBillingNetwork": @([self isBillingNetwork:currentSSID]),
            @"signalQuality": @"good"
        }];
    }
    
    // Add configured networks
    // Note: iOS doesn't expose configured networks list
    
    if (completion) {
        completion(networks, nil);
    }
}

- (void)periodicScan {
    // Background scan logic
    [self scanWithOptions:@{} completion:^(NSArray *networks, NSError *error) {
        for (NSDictionary *network in networks) {
            if ([network[@"isBillingNetwork"] boolValue] && ![network[@"connected"] boolValue]) {
                [self.core emitEvent:@"wifi:billing_network_found" data:network];
            }
        }
    }];
}

- (BOOL)isBillingNetwork:(NSString *)ssid {
    if (!ssid) return NO;
    
    for (NSString *pattern in self.preferredNetworks) {
        if ([ssid hasPrefix:pattern] || [ssid rangeOfString:pattern options:NSCaseInsensitiveSearch].location != NSNotFound) {
            return YES;
        }
    }
    return NO;
}

- (NSString *)getCurrentSSID {
    NSArray *interfaces = (__bridge_transfer NSArray *)CNCopySupportedInterfaces();
    for (NSString *interfaceName in interfaces) {
        NSDictionary *info = (__bridge_transfer NSDictionary *)CNCopyCurrentNetworkInfo((__bridge CFStringRef)interfaceName);
        if (info[@"SSID"]) {
            return info[@"SSID"];
        }
    }
    return nil;
}

- (NSString *)getCurrentBSSID {
    NSArray *interfaces = (__bridge_transfer NSArray *)CNCopySupportedInterfaces();
    for (NSString *interfaceName in interfaces) {
        NSDictionary *info = (__bridge_transfer NSDictionary *)CNCopyCurrentNetworkInfo((__bridge CFStringRef)interfaceName);
        if (info[@"BSSID"]) {
            return info[@"BSSID"];
        }
    }
    return nil;
}

- (void)enableAutoReconnect:(NSDictionary *)config {
    self.autoReconnectEnabled = YES;
    NSLog(@"[WiFiAgent] Auto-reconnect enabled");
}

- (void)disableAutoReconnect {
    self.autoReconnectEnabled = NO;
    NSLog(@"[WiFiAgent] Auto-reconnect disabled");
}

- (void)startBillingTracking:(NSDictionary *)session {
    // Setup billing session monitoring
    NSLog(@"[WiFiAgent] Started billing tracking for session: %@", session[@"id"]);
}

@end