#import <Cordova/CDV.h>
#import <UIKit/UIKit.h>

@interface BackgroundPlugin : CDVPlugin
@property(nonatomic, assign) UIBackgroundTaskIdentifier backgroundTask;
@end

@implementation BackgroundPlugin

- (void)pluginInitialize {
    self.backgroundTask = UIBackgroundTaskInvalid;
}

- (void)start:(CDVInvokedUrlCommand *)command {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.backgroundTask != UIBackgroundTaskInvalid) {
            [self sendResult:@{
                @"active": @YES,
                @"platform": @"ios",
                @"limited": @YES
            } command:command];
            return;
        }

        self.backgroundTask = [[UIApplication sharedApplication]
            beginBackgroundTaskWithName:@"CordovaBackgroundModern"
            expirationHandler:^{
                [self endBackgroundTask];
            }];

        if (self.backgroundTask == UIBackgroundTaskInvalid) {
            [self sendError:@{
                @"code": @"BACKGROUND_START_NOT_ALLOWED",
                @"message": @"iOS did not grant a background execution window.",
                @"platform": @"ios"
            } command:command];
            return;
        }

        [self sendResult:@{
            @"active": @YES,
            @"platform": @"ios",
            @"limited": @YES
        } command:command];
    });
}

- (void)stop:(CDVInvokedUrlCommand *)command {
    dispatch_async(dispatch_get_main_queue(), ^{
        BOOL wasActive = self.backgroundTask != UIBackgroundTaskInvalid;
        [self endBackgroundTask];
        [self sendResult:@{
            @"active": @NO,
            @"stopped": @(wasActive),
            @"platform": @"ios",
            @"limited": @YES
        } command:command];
    });
}

- (void)status:(CDVInvokedUrlCommand *)command {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendResult:@{
            @"active": @(self.backgroundTask != UIBackgroundTaskInvalid),
            @"platform": @"ios",
            @"limited": @YES
        } command:command];
    });
}

- (void)endBackgroundTask {
    if (self.backgroundTask == UIBackgroundTaskInvalid) {
        return;
    }

    UIBackgroundTaskIdentifier task = self.backgroundTask;
    self.backgroundTask = UIBackgroundTaskInvalid;
    [[UIApplication sharedApplication] endBackgroundTask:task];
}

- (void)sendResult:(NSDictionary *)payload command:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:payload];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendError:(NSDictionary *)payload command:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:payload];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

@end
