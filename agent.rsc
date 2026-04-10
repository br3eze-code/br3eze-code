# =============================================
# AGENTOS Secure Telegram Bot - Clean & Safe
# Version: 2026.03.29
# =============================================
:local botToken "8785525787:AAHMbh3PifN8B76TGek4XHltnZCay_WhTnc"
:local allowedUserID "7733493073"
:local lastUpdateID 0


# ================== SEND MESSAGE ==================
:local send do={
    /tool fetch url="https://api.telegram.org/bot$1/sendMessage?chat_id=$2&parse_mode=MarkdownV2&text=$3" \
        keep-result=no mode=https check-certificate=yes
}

# ================== SAFE COMMANDS ==================
:local SAFE_COMMANDS {
    "ping"={ :return "🏓 *Pong!* AgentOS is alive on *$[/system identity get name]*"; };
    "status"={
        :local cpu [/system resource get cpu-load];
        :local freeMem [/system resource get free-memory];
        :local totalMem [/system resource get total-memory];
        :local memPercent [($totalMem - $freeMem) * 100 / $totalMem];
        :return ("🌡️ *System Status*%0ACPU: *$cpu%%*%0AMemory: *$memPercent%* used%0AUptime: $[/system resource get uptime]");
    };
    "help"={ :return "📋 *Available Commands*%0A• `ping`%0A• `status`%0A• `menu` - Show control panel"; };
}

# Startup Message
$send $botToken $allowedUserID "🤖 *AgentOS Secure Activated*%0AHost: *$[/system identity get name]*%0AStatus: *Protected*"

# ================== MAIN LOOP ==================
:while (true) do={
    :do {
        :local response [/tool fetch url="https://api.telegram.org/bot$botToken/getUpdates?offset=$lastUpdateID&timeout=30" as-value output=user mode=https check-certificate=yes];
        
        :if ($response->"status" = "finished") do={
            :local data ($response->"data");
            
            # Update last update ID
            :local uidPos [:find $data "\"update_id\":"];
            :if ($uidPos > 0) do={
                :local idStart ($uidPos + 12);
                :local idEnd [:find $data "," $idStart];
                :if ($idEnd > 0) do={
                    :set lastUpdateID ([:tonum [:pick $data $idStart $idEnd]] + 1);
                }
            }
            
            # Extract command
            :local textPos [:find $data "\"text\":\""];
            :if ($textPos > 0) do={
                :local textStart ($textPos + 8);
                :local textEnd [:find $data "\"" $textStart];
                :local cmd [:pick $data $textStart $textEnd];
                
                # Extract sender ID
                :local chatPos [:find $data "\"chat\":{\"id\":"];
                :if ($chatPos > 0) do={
                    :local chatStart ($chatPos + 13);
                    :local chatEnd [:find $data "," $chatStart];
                    :local sender [:pick $data $chatStart $chatEnd];
                    
                    :if ($sender = $allowedUserID) do={
                        :put "Command: $cmd";
                        
                        :if ($cmd = "menu") do={
                            :local keyboard "[{\"text\":\"📊 Status\",\"callback_data\":\"status\"},{\"text\":\"🏓 Ping\",\"callback_data\":\"ping\"},{\"text\":\"📋 Help\",\"callback_data\":\"help\"}]";
                            /tool fetch url="https://api.telegram.org/bot$botToken/sendMessage?chat_id=$allowedUserID&text=🔰 *AgentOS Control*%0ATap a button:"&reply_markup=$keyboard" keep-result=no mode=https;
                        } else:if ($cmd = "ping" or $cmd = "status" or $cmd = "help") do={
                            :local reply "";
                            :foreach key,value in=$SAFE_COMMANDS do={
                                :if ($key = $cmd) do={ :set reply [$value]; }
                            };
                            $send $botToken $allowedUserID $reply;
                        } else {
                            $send $botToken $allowedUserID "❓ Unknown command. Type `menu` for options.";
                        }
                    }
                }
            }
        }
    } on-error={ :put "Polling timeout..."; }
    :delay 2s;
}
