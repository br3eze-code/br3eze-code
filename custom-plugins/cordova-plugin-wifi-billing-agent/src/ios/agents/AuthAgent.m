//
//  AuthAgent.m
//  WiFi Billing Agent
//

#import "AuthAgent.h"
#import "CoreAgent.h"

@interface AuthAgent()

@property (nonatomic, strong) NSString *apiEndpoint;
@property (nonatomic, strong) NSString *apiKey;
@property (nonatomic, strong) NSString *currentToken;
@property (nonatomic, strong) NSString *currentUserId;
@property (nonatomic, assign) NSTimeInterval tokenExpiry;
@property (nonatomic, strong) NSTimer *refreshTimer;

@end

@implementation AuthAgent

- (instancetype)initWithConfig:(NSDictionary *)config {
    self = [super init];
    if (self) {
        _apiEndpoint = config[@"apiEndpoint"] ?: @"";
        _apiKey = config[@"apiKey"] ?: @"";
        
        // Load from keychain if available
        [self loadStoredCredentials];
    }
    return self;
}

- (void)initialize {
    NSLog(@"[AuthAgent] Initializing");
    
    // Check if we have a valid token
    if (self.currentToken && self.tokenExpiry > [[NSDate date] timeIntervalSince1970]) {
        NSLog(@"[AuthAgent] Found valid token");
        [self scheduleTokenRefresh];
    }
}

- (void)shutdown {
    NSLog(@"[AuthAgent] Shutting down");
    [self.refreshTimer invalidate];
}

- (NSDictionary *)authenticate:(NSDictionary *)credentials {
    NSString *username = credentials[@"username"];
    NSString *password = credentials[@"password"];
    NSString *deviceId = credentials[@"deviceId"];
    
    // In production, call your backend API
    // For now, simulate successful auth
    
    self.currentToken = [self generateToken:username];
    self.currentUserId = username;
    self.tokenExpiry = [[NSDate date] timeIntervalSince1970] + (24 * 60 * 60); // 24 hours
    
    [self saveCredentials];
    [self scheduleTokenRefresh];
    
    NSLog(@"[AuthAgent] Authenticated user: %@", username);
    
    return @{
        @"success": @(YES),
        @"token": self.currentToken,
        @"userId": username,
        @"expiry": @(self.tokenExpiry),
        @"deviceProfiled": @(YES)
    };
}

- (NSDictionary *)validateToken:(NSString *)token {
    if (!self.currentToken || ![self.currentToken isEqualToString:token]) {
        return @{
            @"valid": @(NO),
            @"reason": @"invalid_token"
        };
    }
    
    if ([[NSDate date] timeIntervalSince1970] > self.tokenExpiry) {
        return @{
            @"valid": @(NO),
            @"reason": @"expired"
        };
    }
    
    return @{
        @"valid": @(YES),
        @"userId": self.currentUserId,
        @"expiresIn": @(self.tokenExpiry - [[NSDate date] timeIntervalSince1970])
    };
}

- (NSDictionary *)refreshToken {
    if (!self.currentToken || !self.currentUserId) {
        return @{
            @"success": @(NO),
            @"error": @"No active session"
        };
    }
    
    // Generate new token
    self.currentToken = [self generateToken:self.currentUserId];
    self.tokenExpiry = [[NSDate date] timeIntervalSince1970] + (24 * 60 * 60);
    
    [self saveCredentials];
    [self scheduleTokenRefresh];
    
    NSLog(@"[AuthAgent] Token refreshed");
    
    return @{
        @"success": @(YES),
        @"token": self.currentToken,
        @"expiry": @(self.tokenExpiry)
    };
}

- (void)logout {
    self.currentToken = nil;
    self.currentUserId = nil;
    self.tokenExpiry = 0;
    
    [self.refreshTimer invalidate];
    [self clearStoredCredentials];
    
    NSLog(@"[AuthAgent] Logged out");
}

- (NSString *)generateToken:(NSString *)username {
    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970] * 1000;
    NSString *random = [[NSUUID UUID] UUIDString];
    NSString *combined = [NSString stringWithFormat:@"pc-tok-%.0f-%@-%@", timestamp, username, random];
    
    // Base64 encode
    NSData *data = [combined dataUsingEncoding:NSUTF8StringEncoding];
    return [data base64EncodedStringWithOptions:0];
}

- (void)scheduleTokenRefresh {
    [self.refreshTimer invalidate];
    
    // Refresh 5 minutes before expiry
    NSTimeInterval refreshInterval = self.tokenExpiry - [[NSDate date] timeIntervalSince1970] - (5 * 60);
    
    if (refreshInterval > 0) {
        self.refreshTimer = [NSTimer scheduledTimerWithTimeInterval:refreshInterval
                                                             target:self
                                                           selector:@selector(refreshToken)
                                                           userInfo:nil
                                                            repeats:NO];
    }
}

- (void)saveCredentials {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    [defaults setObject:self.currentToken forKey:@"wba_auth_token"];
    [defaults setObject:self.currentUserId forKey:@"wba_user_id"];
    [defaults setDouble:self.tokenExpiry forKey:@"wba_token_expiry"];
    [defaults synchronize];
}

- (void)loadStoredCredentials {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    self.currentToken = [defaults objectForKey:@"wba_auth_token"];
    self.currentUserId = [defaults objectForKey:@"wba_user_id"];
    self.tokenExpiry = [defaults doubleForKey:@"wba_token_expiry"];
}

- (void)clearStoredCredentials {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    [defaults removeObjectForKey:@"wba_auth_token"];
    [defaults removeObjectForKey:@"wba_user_id"];
    [defaults removeObjectForKey:@"wba_token_expiry"];
    [defaults synchronize];
}

@end