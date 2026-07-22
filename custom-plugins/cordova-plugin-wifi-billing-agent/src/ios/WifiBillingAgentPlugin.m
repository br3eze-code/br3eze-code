#import "WiFiBillingAgentPlugin.h"
#import "WiFiBillingService.h"
#import "GossipService.h"
#import <NetworkExtension/NetworkExtension.h>
#import <SystemConfiguration/CaptiveNetwork.h>

@implementation WiFiBillingAgentPlugin

- (void)pluginInitialize {
    [super pluginInitialize];
    
    self.wifiService = [[WiFiBillingService alloc] init];
    self.gossipService = [[GossipService alloc] init];
    
    [self.wifiService initialize];
    [self.gossipService initialize];
}

- (void)initialize:(CDVInvokedUrlCommand*)command {
    [self.commandDelegate runInBackground:^{
        NSDictionary* config = [command argumentAtIndex:0];
        
        NSString* agentId = config[@"agentId"] ?: [self generateAgentId];
        
        // Initialize services
        [self.wifiService configure:config];
        [self.gossipService configure:config];
        
        NSMutableDictionary* result = [NSMutableDictionary dictionary];
        result[@"status"] = @"initialized";
        result[@"platform"] = @"ios";
        result[@"version"] = @"4.0.0";
        result[@"agentId"] = agentId;
        
        CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
            messageAsDictionary:result];
        [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
    }];
}

- (void)connect:(CDVInvokedUrlCommand*)command {
    NSDictionary* options = [command argumentAtIndex:0];
    NSString* ssid = options[@"ssid"];
    NSString* password = options[@"password"];
    
    if (@available(iOS 11.0, *)) {
        NEHotspotConfiguration* config = [[NEHotspotConfiguration alloc] 
            initWithSSID:ssid passphrase:password isWEP:NO];
        config.joinOnce = NO;
        
        [[NEHotspotConfigurationManager sharedManager] applyConfiguration:config 
            completionHandler:^(NSError * _Nullable error) {
            
            NSMutableDictionary* result = [NSMutableDictionary dictionary];
            
            if (error) {
                result[@"success"] = @NO;
                result[@"error"] = error.localizedDescription;
            } else {
                result[@"success"] = @YES;
                result[@"ssid"] = ssid;
                result[@"method"] = @"hotspot_config";
                result[@"connectionId"] = [[NSUUID UUID] UUIDString];
                
                // Start billing session if needed
                if ([options[@"isBillingNetwork"] boolValue]) {
                    [self.wifiService startBillingSession:options];
                    result[@"billingActive"] = @YES;
                }
            }
            
            CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
                messageAsDictionary:result];
            [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
        }];
    } else {
        CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR 
            messageAsString:@"iOS 11+ required"];
        [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
    }
}

- (void)disconnect:(CDVInvokedUrlCommand*)command {
    NSDictionary* options = [command argumentAtIndex:0];
    NSString* ssid = options[@"ssid"] ?: [self getCurrentSSID];
    BOOL endSession = [options[@"endSession"] boolValue];
    
    if (@available(iOS 11.0, *)) {
        [[NEHotspotConfigurationManager sharedManager] removeConfigurationForSSID:ssid];
    }
    
    NSMutableDictionary* result = [NSMutableDictionary dictionary];
    result[@"success"] = @YES;
    result[@"ssid"] = ssid;
    
    if (endSession) {
        NSDictionary* sessionResult = [self.wifiService endBillingSession:ssid];
        result[@"sessionEnded"] = @YES;
        result[@"finalCost"] = sessionResult[@"finalCost"];
    }
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)getConnectionInfo:(CDVInvokedUrlCommand*)command {
    NSMutableDictionary* info = [NSMutableDictionary dictionary];
    
    NSString* ssid = [self getCurrentSSID];
    if (ssid) {
        info[@"connected"] = @YES;
        info[@"ssid"] = ssid;
        info[@"bssid"] = [self getCurrentBSSID];
        
        // Add billing info
        NSDictionary* session = [self.wifiService getActiveSession];
        if (session) {
            info[@"sessionId"] = session[@"sessionId"];
            info[@"billing"] = session;
        }
    } else {
        info[@"connected"] = @NO;
    }
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:info];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)scan:(CDVInvokedUrlCommand*)command {
    // iOS requires special entitlements for WiFi scanning
    // Return cached or nearby networks via other methods
    
    NSMutableArray* networks = [NSMutableArray array];
    
    // Get current network info
    NSString* currentSSID = [self getCurrentSSID];
    if (currentSSID) {
        [networks addObject:@{
            @"ssid": currentSSID,
            @"bssid": [self getCurrentBSSID] ?: @"",
            @"connected": @YES
        }];
    }
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsArray:networks];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)getSessionStatus:(CDVInvokedUrlCommand*)command {
    NSDictionary* session = [self.wifiService getActiveSession];
    
    NSMutableDictionary* status = [NSMutableDictionary dictionary];
    if (session) {
        status[@"active"] = @YES;
        [status addEntriesFromDictionary:session];
    } else {
        status[@"active"] = @NO;
    }
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:status];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)pauseSession:(CDVInvokedUrlCommand*)command {
    NSString* reason = [command argumentAtIndex:0];
    NSDictionary* result = [self.wifiService pauseSession:reason];
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)resumeSession:(CDVInvokedUrlCommand*)command {
    NSDictionary* result = [self.wifiService resumeSession];
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)getGossipPeers:(CDVInvokedUrlCommand*)command {
    NSDictionary* peers = [self.gossipService getPeers];
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:peers];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)gossipBroadcast:(CDVInvokedUrlCommand*)command {
    NSString* type = [command argumentAtIndex:0];
    NSDictionary* payload = [command argumentAtIndex:1];
    
    NSString* messageId = [self.gossipService broadcast:type payload:payload];
    
    NSDictionary* result = @{
        @"messageId": messageId ?: @"",
        @"broadcasted": @YES
    };
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)getSystemStatus:(CDVInvokedUrlCommand*)command {
    NSMutableDictionary* status = [NSMutableDictionary dictionary];
    status[@"platform"] = @"ios";
    status[@"agents"] = @{
        @"core": @YES,
        @"wifi": @YES,
        @"billing": @YES,
        @"gossip": @YES
    };
    status[@"gossip"] = [self.gossipService getStats];
    status[@"connection"] = [self.wifiService getConnectionInfo];
    status[@"session"] = [self.wifiService getActiveSession] ?: [NSNull null];
    
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:status];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

- (void)shutdown:(CDVInvokedUrlCommand*)command {
    [self.wifiService shutdown];
    [self.gossipService shutdown];
    
    NSDictionary* result = @{@"shutdown": @YES};
    CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK 
        messageAsDictionary:result];
    [self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
}

// Helper methods
- (NSString*)getCurrentSSID {
    NSArray* interfaces = (__bridge_transfer NSArray*)CNCopySupportedInterfaces();
    for (NSString* interfaceName in interfaces) {
        NSDictionary* info = (__bridge_transfer NSDictionary*)CNCopyCurrentNetworkInfo((__bridge CFStringRef)interfaceName);
        if (info[@"SSID"]) {
            return info[@"SSID"];
        }
    }
    return nil;
}

- (NSString*)getCurrentBSSID {
    NSArray* interfaces = (__bridge_transfer NSArray*)CNCopySupportedInterfaces();
    for (NSString* interfaceName in interfaces) {
        NSDictionary* info = (__bridge_transfer NSDictionary*)CNCopyCurrentNetworkInfo((__bridge CFStringRef)interfaceName);
        if (info[@"BSSID"]) {
            return info[@"BSSID"];
        }
    }
    return nil;
}

- (NSString*)generateAgentId {
    return [NSString stringWithFormat:@"pc-agent-%ld-%@", 
        (long)[[NSDate date] timeIntervalSince1970],
        [[NSUUID UUID] UUIDString]];
}

@end