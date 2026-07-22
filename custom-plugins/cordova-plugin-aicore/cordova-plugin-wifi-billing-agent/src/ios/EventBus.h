//
//  EventBus.h
//  WiFi Billing Agent
//

#import <Foundation/Foundation.h>

@interface EventBus : NSObject

- (void)on:(NSString *)event handler:(void (^)(NSDictionary *))handler;
- (void)on:(NSString *)event handler:(void (^)(NSDictionary *))handler priority:(NSInteger)priority;
- (void)once:(NSString *)event handler:(void (^)(NSDictionary *))handler;
- (void)off:(NSString *)event handler:(void (^)(NSDictionary *))handler;
- (void)emit:(NSString *)event data:(NSDictionary *)data;
- (void)use:(BOOL (^)(NSString *, NSDictionary *))middleware;
- (NSDictionary *)getMetrics;

@end