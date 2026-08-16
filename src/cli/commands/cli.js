import WebSocket from 'ws';
import React from 'react';
import { render, Text, Box, useInput } from 'ink';
import { getConfig } from '../../core/config.js';

export default (program) => {
    program
        .command('cli')
        .description('Connect to AgentOS Interactive CLI via WebSocket')
        .option('--host <host>', 'Gateway host', '127.0.0.1')
        .option('--port <port>', 'Gateway port', '19876')
        .option('--token <token>', 'Authentication token')
        .action(async (options) => {
            const config = getConfig();
            const token = options.token || config.gateway?.token || process.env.GATEWAY_TOKEN;
            const port = options.port || config.gateway?.port || 19876;
            const host = options.host || '127.0.0.1';
            
            const wsUrl = `ws://${host}:${port}/ws`;
            
            // Start the Ink React App
            const App = () => {
                const [messages, setMessages] = React.useState([
                    { type: 'info', text: 'Welcome to AgentOS Interactive CLI!' },
                    { type: 'text', text: 'Type "help" to view available commands, "exit" to quit.' }
                ]);
                const [input, setInput] = React.useState('');
                const [connected, setConnected] = React.useState(false);
                const [cursorPos, setCursorPos] = React.useState(0);
                const [history, setHistory] = React.useState([]);
                const [historyIndex, setHistoryIndex] = React.useState(-1);
                const [status, setStatus] = React.useState('idle');
                const [lastError, setLastError] = React.useState('');
                const wsRef = React.useRef(null);
                
                React.useEffect(() => {
                    const ws = new WebSocket(wsUrl, {
                        headers: {
                            'x-agentos-token': token
                        }
                    });
                    ws.on('error', () => {}); // Handle errors silently to prevent crash
                    wsRef.current = ws;
                    
                    ws.on('open', () => {
                        setConnected(true);
                        ws.send(JSON.stringify({ type: 'cli.start' }));
                    });
                    
                    ws.on('message', (data) => {
                        try {
                            const msg = JSON.parse(data);
                            if (msg.type === 'cli.output') {
                                const payload = msg.payload || {};
                                if (payload.type === 'clear') {
                                    setMessages([]);
                                } else if (payload.type === 'list') {
                                    setMessages(prev => [...prev, { type: 'list', title: payload.title, items: payload.items }]);
                                } else if (payload.type === 'table') {
                                    setMessages(prev => [...prev, { type: 'table', title: payload.title, data: payload.data }]);
                                } else {
                                    const text = payload.text || payload.message || payload.result || payload.content || '';
                                    if (payload.type === 'executing' || payload.type === 'thinking') setStatus(payload.type);
                                    else if (payload.type === 'approval' || payload.type === 'confirm') setStatus('approval');
                                    else if (payload.type === 'cancelled') setStatus('cancelled');
                                    else if (payload.type === 'error') { setStatus('error'); setLastError(text); }
                                    else if (payload.type === 'prompt' || payload.type === 'ai_response' || payload.type === 'success') setStatus('idle');
                                    if (text) {
                                        setMessages(prev => [...prev, { type: payload.type || 'text', text }]);
                                    }
                                }
                            }
                        } catch (e) {}
                    });
                    
                    ws.on('close', () => {
                        setConnected(false);
                        process.exit(0);
                    });
                    
                    return () => ws.close();
                }, []);
                
                useInput((char, key) => {
                    if (key.escape || (key.ctrl && char === 'c')) {
                        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'cli.input', input: '\u0003' }));
                        setStatus('cancelled');
                        return;
                    }
                    if (key.return) {
                        const trimmed = input.trim();
                        if (trimmed) {
                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                                wsRef.current.send(JSON.stringify({ type: 'cli.input', input: trimmed + '\n' }));
                            }
                            setHistory(prev => {
                                const updated = [...prev, trimmed];
                                if (updated.length > 50) updated.shift();
                                return updated;
                            });
                        } else {
                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                                wsRef.current.send(JSON.stringify({ type: 'cli.input', input: '\n' }));
                            }
                        }
                        setInput('');
                        setCursorPos(0);
                        setHistoryIndex(-1);
                    } else if (key.backspace || key.delete) {
                        if (cursorPos > 0) {
                            setInput(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
                            setCursorPos(prev => prev - 1);
                        }
                    } else if (key.leftArrow) {
                        if (cursorPos > 0) setCursorPos(prev => prev - 1);
                    } else if (key.rightArrow) {
                        if (cursorPos < input.length) setCursorPos(prev => prev + 1);
                    } else if (key.upArrow) {
                        if (history.length > 0) {
                            const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
                            setHistoryIndex(newIndex);
                            setInput(history[newIndex]);
                            setCursorPos(history[newIndex].length);
                        }
                    } else if (key.downArrow) {
                        if (historyIndex !== -1) {
                            const newIndex = historyIndex + 1;
                            if (newIndex >= history.length) {
                                setHistoryIndex(-1);
                                setInput('');
                                setCursorPos(0);
                            } else {
                                setHistoryIndex(newIndex);
                                setInput(history[newIndex]);
                                setCursorPos(history[newIndex].length);
                            }
                        }
                    } else if (char) {
                        setInput(prev => prev.slice(0, cursorPos) + char + prev.slice(cursorPos));
                        setCursorPos(prev => prev + 1);
                    }
                });
                
                return React.createElement(Box, { flexDirection: 'column', padding: 1 },
                    // Boxed Header Banner
                    React.createElement(Box, { borderStyle: 'round', borderColor: 'cyan', paddingX: 2, flexDirection: 'column', marginBottom: 1 },
                        React.createElement(Text, { bold: true, color: 'cyan' }, '🤖 AgentOS Interactive CLI & REPL v2.0'),
                        React.createElement(Text, { dimColor: true }, 'Connected to Gateway | Ready for inputs')
                    ),
                    
                    // Messages
                    React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
                        messages.slice(-15).map((m, i) => {
                            if (m.type === 'list') {
                                return React.createElement(Box, { key: i, flexDirection: 'column', marginY: 0 },
                                    React.createElement(Text, { bold: true, color: 'magenta' }, m.title),
                                    ...m.items.map((item, j) => React.createElement(Text, { key: j, color: 'white' }, `  ${item}`))
                                );
                            }
                            if (m.type === 'table') {
                                return React.createElement(Box, { key: i, flexDirection: 'column', marginY: 0 },
                                    React.createElement(Text, { bold: true, color: 'magenta' }, m.title),
                                    ...Object.entries(m.data || {}).map(([k, v], j) => React.createElement(Text, { key: j, color: 'white' }, `  ${k}: ${v}`))
                                );
                            }
                            
                            let color = 'white';
                            let bold = false;
                            if (m.type === 'success') { color = 'green'; bold = true; }
                            else if (m.type === 'error') { color = 'red'; bold = true; }
                            else if (m.type === 'warning') { color = 'yellow'; }
                            else if (m.type === 'thinking') { color = 'yellow'; }
                            else if (m.type === 'info') { color = 'cyan'; }
                            else if (m.type === 'code') { color = 'gray'; }
                            
                            return React.createElement(Box, { key: i }, 
                                React.createElement(Text, { color, bold }, m.text)
                            );
                        })
                    ),
                    
                    // Input prompt and state bar
                    React.createElement(Box, { flexDirection: 'column' },
                        React.createElement(Text, { dimColor: true }, `status: ${status}${lastError ? ` — ${lastError}` : ''}  |  Enter submit  Esc/Ctrl+C cancel  ↑↓ history  /back`),
                        React.createElement(Box, null,
                            React.createElement(Text, { color: 'green', bold: true }, connected ? 'AgentOS> ' : 'Connecting... '),
                            React.createElement(Text, {}, input)
                        )
                    )
                );
            };

            const app = render(React.createElement(App));
        });
};
