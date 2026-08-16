#import <Cordova/CDV.h>
#import <SystemConfiguration/SCNetworkReachability.h>
#import <ifaddrs.h>
#import <net/if.h>

@interface AgentOSNetworkToolsPlugin : CDVPlugin
- (void)capabilities:(CDVInvokedUrlCommand *)command;
- (void)connectivity:(CDVInvokedUrlCommand *)command;
- (void)interfaces:(CDVInvokedUrlCommand *)command;
- (void)agentRequest:(CDVInvokedUrlCommand *)command;
@end

@implementation AgentOSNetworkToolsPlugin

- (void)capabilities:(CDVInvokedUrlCommand *)command {
    NSDictionary *result = @{
        @"supported": @YES,
        @"platform": @"ios",
        @"localTelemetry": @YES,
        @"agentGatewayRequests": @NO,
        @"actions": @[@"capabilities", @"connectivity", @"interfaces"]
    };
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:result] callbackId:command.callbackId];
}

- (void)connectivity:(CDVInvokedUrlCommand *)command {
    SCNetworkReachabilityRef reachability = SCNetworkReachabilityCreateWithName(NULL, "agentos.invalid");
    SCNetworkReachabilityFlags flags = 0;
    BOOL reachable = reachability && SCNetworkReachabilityGetFlags(reachability, &flags) && (flags & kSCNetworkReachabilityFlagsReachable);
    if (reachability) CFRelease(reachability);

    NSDictionary *result = @{
        @"connected": @(reachable),
        @"validated": @NO,
        @"transport": reachable ? @"other" : @"offline"
    };
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:result] callbackId:command.callbackId];
}

- (void)interfaces:(CDVInvokedUrlCommand *)command {
    NSMutableArray *items = [NSMutableArray array];
    struct ifaddrs *interfaces = NULL;
    if (getifaddrs(&interfaces) == 0) {
        for (struct ifaddrs *current = interfaces; current != NULL; current = current->ifa_next) {
            if (!current->ifa_name) continue;
            NSString *name = [NSString stringWithUTF8String:current->ifa_name];
            BOOL exists = NO;
            for (NSDictionary *item in items) {
                if ([item[@"name"] isEqualToString:name]) { exists = YES; break; }
            }
            if (!exists) {
                [items addObject:@{
                    @"name": name,
                    @"up": @((current->ifa_flags & IFF_UP) != 0),
                    @"loopback": @((current->ifa_flags & IFF_LOOPBACK) != 0)
                }];
            }
        }
        freeifaddrs(interfaces);
    }
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsArray:items] callbackId:command.callbackId];
}

- (void)agentRequest:(CDVInvokedUrlCommand *)command {
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"AgentOS network-tool execution must be authorized by the gateway"] callbackId:command.callbackId];
}

@end
