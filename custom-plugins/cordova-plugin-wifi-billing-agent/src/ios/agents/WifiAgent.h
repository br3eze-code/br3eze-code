//
//  WiFiAgent.h
//  WiFi Billing Agent
//

#import <Foundation/Foundation.h>
#import <NetworkExtension/NetworkExtension.h>

@class CoreAgent;

@interface WiFiAgent : NSObject

@property(nonatomic, weak) CoreAgent *core;
@property(nonatomic, strong) NSString *currentSSID;
@property(nonatomic, strong) NSString *currentConnectionId;
@property(nonatomic, assign) BOOL autoReconnectEnabled;

- (instancetype)initWithConfig:(NSDictionary *)config;
- (void)initialize;
- (void)activate;
- (void)deactivate;

- (void)connect:(NSString *)ssid
          password:(NSString *)password
         algorithm:(NSString *)algorithm
          isHidden:(BOOL)isHidden
    billingSession:(NSDictionary *)billingSession
        completion:(void (^)(NSDictionary *result, NSError *error))completion;

- (void)disconnect:(void (^)(NSDictionary *result, NSError *error))completion;
- (void)disconnectWithOptions:(NSDictionary *)options completion:(void (^)(NSDictionary *, NSError *))completion;

- (NSDictionary *)getConnectionInfo;
- (void)scanWithOptions:(NSDictionary *)options completion:(void (^)(NSArray *networks, NSError *error))completion;

- (BOOL)isBillingNetwork:(NSString *)ssid;
- (void)enableAutoReconnect:(NSDictionary *)config;
- (void)disableAutoReconnect;

@end