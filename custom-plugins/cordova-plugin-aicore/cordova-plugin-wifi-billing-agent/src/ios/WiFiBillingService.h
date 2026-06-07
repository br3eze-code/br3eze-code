#import <Foundation/Foundation.h>

@interface WiFiBillingService : NSObject

- (void)initialize;
- (void)configure:(NSDictionary*)config;
- (void)startBillingSession:(NSDictionary*)options;
- (NSDictionary*)endBillingSession:(NSString*)ssid;
- (NSDictionary*)getActiveSession;
- (NSDictionary*)pauseSession:(NSString*)reason;
- (NSDictionary*)resumeSession;
- (NSDictionary*)getConnectionInfo;
- (void)shutdown;

@end
