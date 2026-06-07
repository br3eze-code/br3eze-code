# System script for connection notification
/system script
add name=notify-connection source={
    :local mac $"mac-address";
    :local user $"user";
    :local ip $"address";
    :local sessionId $"session-id";
    
    /tool fetch url="{{AGENTOS_NODE_URL}}/api/mikrotik/webhook/connect" \
        http-method=post \
        http-data="username=$user&mac=$mac&ip=$ip&sessionId=$sessionId" \
        keep-result=no;
}

# System script for disconnection notification
/system script
add name=notify-disconnection source={
    :local user $"user";
    :local bytesIn $"bytes-in";
    :local bytesOut $"bytes-out";
    :local uptime $"uptime";
    
    /tool fetch url="{{AGENTOS_NODE_URL}}/api/mikrotik/webhook/disconnect" \
        http-method=post \
        http-data="username=$user&bytesIn=$bytesIn&bytesOut=$bytesOut&uptime=$uptime" \
        keep-result=no;
}

# Wireless Monitoring Tool
/system script
add name=monitor-wireless source={
    :foreach i in=[/interface wireless find] do={
        :local ifaceName [/interface wireless get $i name];
        :local ifaceStatus "down";
        :if ([/interface wireless get $i disabled] = no) do={
            :set ifaceStatus "up";
        }
        :local ssid [/interface wireless get $i ssid];
        
        :if ([/interface wireless get $i running] = no) do={
            :set ifaceStatus "inactive";
        }

        :global lastWirelessStatus;
        :if ([:type $lastWirelessStatus] != "array") do={ :set lastWirelessStatus [:toarray ""] }
        
        :local prevStatus ($lastWirelessStatus->$ifaceName);
        
        :if ($prevStatus != $ifaceStatus) do={
            :log info ("AgentOS: Wireless status change on $ifaceName to $ifaceStatus");
            /tool fetch url="{{AGENTOS_NODE_URL}}/api/mikrotik/webhook/wireless" \
                http-method=post \
                http-data="interface=$ifaceName&status=$ifaceStatus&ssid=$ssid" \
                keep-result=no;
            :set ($lastWirelessStatus->$ifaceName) $ifaceStatus;
        }
    }
}

/system scheduler
add interval=1m name=run-wireless-monitor on-event=monitor-wireless start-time=startup