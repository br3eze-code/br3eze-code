#import <Cordova/CDV.h>
#import "WiFiBillingService.h"
#import "GossipService.h"

@interface WiFiBillingAgentPlugin : CDVPlugin

@property (nonatomic, strong) WiFiBillingService *wifiService;
@property (nonatomic, strong) GossipService *gossipService;

- (void)initialize:(CDVInvokedUrlCommand*)command;
- (void)connect:(CDVInvokedUrlCommand*)command;
- (void)disconnect:(CDVInvokedUrlCommand*)command;
- (void)getConnectionInfo:(CDVInvokedUrlCommand*)command;
- (void)scan:(CDVInvokedUrlCommand*)command;
- (void)getSessionStatus:(CDVInvokedUrlCommand*)command;
- (void)pauseSession:(CDVInvokedUrlCommand*)command;
- (void)resumeSession:(CDVInvokedUrlCommand*)command;
- (void)getGossipPeers:(CDVInvokedUrlCommand*)command;
- (void)gossipBroadcast:(CDVInvokedUrlCommand*)command;
- (void)getSystemStatus:(CDVInvokedUrlCommand*)command;
- (void)shutdown:(CDVInvokedUrlCommand*)command;

@end
