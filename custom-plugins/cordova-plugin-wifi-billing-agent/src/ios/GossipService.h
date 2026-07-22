#import <Foundation/Foundation.h>

@interface GossipService : NSObject

- (void)initialize;
- (void)configure:(NSDictionary*)config;
- (NSDictionary*)getPeers;
- (NSString*)broadcast:(NSString*)type payload:(NSDictionary*)payload;
- (NSDictionary*)getStats;
- (void)shutdown;

@end
