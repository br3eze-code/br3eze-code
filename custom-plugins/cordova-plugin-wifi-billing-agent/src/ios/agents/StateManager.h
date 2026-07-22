//
//  StateManager.h
//  WiFi Billing Agent
//

#import <Foundation/Foundation.h>

@interface StateManager : NSObject

- (void)initializeWithPersistence:(BOOL)persistence encryption:(BOOL)encryption sync:(BOOL)sync;
- (void)set:(NSString *)key value:(id)value options:(NSDictionary *)options;
- (id)get:(NSString *)key options:(NSDictionary *)options;
- (void)close;

@end