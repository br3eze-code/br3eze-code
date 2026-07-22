//
//  AuthAgent.h
//  WiFi Billing Agent
//

#import <Foundation/Foundation.h>

@class CoreAgent;

@interface AuthAgent : NSObject

@property(nonatomic, weak) CoreAgent *core;

- (instancetype)initWithConfig:(NSDictionary *)config;
- (void)initialize;
- (void)shutdown;

- (NSDictionary *)authenticate:(NSDictionary *)credentials;
- (NSDictionary *)validateToken:(NSString *)token;
- (NSDictionary *)refreshToken;
- (void)logout;

@end