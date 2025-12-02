

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IrcClient } from './services/IrcClient';
import { IrcParser } from './services/ircParser';
import { IrcServerConfig, IrcServerState, IrcChannel, MessageType, IrcMessage } from './types';
import { HashIcon, ServerIcon, SendIcon, UserIcon, PlusIcon, SettingsIcon, XIcon } from './components/Icons';

// URL Parsing and Formatting
const formatContent = (text: string) => {
  const htmlContent = IrcParser.parseContentToHtml(text);
  
  // Linkify - We need to be careful not to double escape or break HTML tags
  // For simplicity in this React hybrid, we will assume URLs don't overlap with tags for now
  // or simple split. A robust solution needs a full tokenizers.
  // We will simply set dangerouslySetInnerHTML with the parsed IRC HTML
  return <span dangerouslySetInnerHTML={{ __html: htmlContent }} />;
};

// Generate a random ID
const uuid = () => Math.random().toString(36).substr(2, 9);

export default function App() {
  const [servers, setServers] = useState<IrcServerState[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannelName, setActiveChannelName] = useState<string>('server'); 
  const [inputMessage, setInputMessage] = useState('');
  
  // Modals & Popups
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [userContextMenu, setUserContextMenu] = useState<{ x: number, y: number, nick: string } | null>(null);

  const [newServerForm, setNewServerForm] = useState<IrcServerConfig>({
    id: '',
    name: 'Freenode',
    host: 'ws://127.0.0.1',
    port: 8080,
    nick: 'GuestUser',
    username: 'armbian_user',
    realname: 'Armbian WebIRC',
    tls: false,
    autoConnect: true,
    channels: ['#armbian']
  });

  const clientsRef = useRef<{ [key: string]: IrcClient }>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize from LocalStorage and Request Notifications
  useEffect(() => {
    const saved = localStorage.getItem('irc_servers');
    if (saved) {
      try {
        const parsedConfigs: IrcServerConfig[] = JSON.parse(saved);
        const initialStates: IrcServerState[] = parsedConfigs.map(config => ({
          config,
          connected: false,
          currentNick: config.nick,
          channels: {},
          serverLog: []
        }));
        setServers(initialStates);
      } catch (e) {
        console.error("Failed to load saved servers", e);
      }
    }

    // Request Notification Permission
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  }, []);

  const saveConfig = (newServers: IrcServerState[]) => {
    const configs = newServers.map(s => s.config);
    localStorage.setItem('irc_servers', JSON.stringify(configs));
  };

  // --- Notification Logic ---
  const sendNotification = (title: string, body: string) => {
    if (document.hidden && Notification.permission === "granted") {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  };

  const addLog = useCallback((serverId: string, channelName: string, message: IrcMessage) => {
    setServers(prev => prev.map(s => {
      if (s.config.id !== serverId) return s;

      if (channelName === 'server') {
        return { ...s, serverLog: [...s.serverLog, message] };
      }

      const channel = s.channels[channelName];
      if (!channel) return s;

      const isActive = activeServerId === serverId && activeChannelName === channelName;
      let highlight = message.content.includes(s.currentNick);
      
      // Notification Trigger
      if (!message.isSelf && message.type === MessageType.PRIVMSG) {
          if (!isActive || document.hidden) {
              if (highlight) {
                  sendNotification(`被提到了: ${message.from}`, message.content);
              } else if (channel.type === 'query') {
                  sendNotification(`私信: ${message.from}`, message.content);
              } else {
                  // Optional: Notify on all channel messages? Maybe too noisy.
                  // sendNotification(`新消息 ${channelName}`, `${message.from}: ${message.content}`);
              }
          }
      }

      return {
        ...s,
        channels: {
          ...s.channels,
          [channelName]: {
            ...channel,
            messages: [...channel.messages, { ...message, highlight }],
            unreadCount: (!isActive) ? channel.unreadCount + 1 : 0
          }
        }
      };
    }));
  }, [activeServerId, activeChannelName]);

  const handleConnect = (config: IrcServerConfig) => {
    if (clientsRef.current[config.id]) return; // Already exists

    const client = new IrcClient(config);
    clientsRef.current[config.id] = client;

    const sysMsg = (content: string, type: MessageType = MessageType.SYSTEM): IrcMessage => ({
      id: uuid(), timestamp: Date.now(), from: 'System', type, content, isSelf: false, highlight: false
    });

    client.on('status', (status) => {
       setServers(prev => prev.map(s => s.config.id === config.id ? { ...s, connected: status === 'connected' } : s));
       if (status === 'connected') {
         addLog(config.id, 'server', sysMsg('已连接到服务器 ' + config.host));
       } else if (status === 'disconnected') {
         addLog(config.id, 'server', sysMsg('与服务器断开连接'));
       }
    });

    client.on('error', (err) => {
      addLog(config.id, 'server', { ...sysMsg(`错误: ${err}`), type: MessageType.ERROR });
    });

    client.on('registered', () => {
      addLog(config.id, 'server', sysMsg(`已注册为 ${client.currentNick}`));
    });

    client.on('join', ({ nick, channel }) => {
      setServers(prev => prev.map(s => {
        if (s.config.id !== config.id) return s;

        // If I joined
        if (nick === client.currentNick) {
          return {
            ...s,
            channels: {
              ...s.channels,
              [channel]: {
                name: channel,
                type: 'channel',
                messages: [sysMsg(`您已加入 ${channel}`)],
                users: [],
                unreadCount: 0,
                joined: true,
                modes: { n: true, t: true } // Default assumptions
              }
            }
          };
        } else {
          const ch = s.channels[channel];
          if (!ch) return s;
          return {
            ...s,
            channels: {
              ...s.channels,
              [channel]: {
                ...ch,
                users: [...ch.users, nick],
                messages: [...ch.messages, sysMsg(`${nick} 加入了频道`)]
              }
            }
          };
        }
      }));
    });

    client.on('part', ({ nick, channel }) => {
        setServers(prev => prev.map(s => {
          if (s.config.id !== config.id) return s;
          const ch = s.channels[channel];
          if(!ch) return s;

          if (nick === client.currentNick) {
              const newChannels = {...s.channels};
              delete newChannels[channel];
              return { ...s, channels: newChannels };
          }

          return {
            ...s,
            channels: {
              ...s.channels,
              [channel]: {
                ...ch,
                users: ch.users.filter(u => u.replace(/^[@+]/, '') !== nick),
                messages: [...ch.messages, sysMsg(`${nick} 离开了频道`)]
              }
            }
          };
        }));
    });
    
    // Kick Handling
    client.on('kick', ({ channel, kickedNick, actor, reason }) => {
         addLog(config.id, channel, sysMsg(`${kickedNick} 被 ${actor} 踢出 (${reason})`, MessageType.KICK));
         setServers(prev => prev.map(s => {
            if (s.config.id !== config.id) return s;
            const ch = s.channels[channel];
            if (!ch) return s;
            
            if (kickedNick === client.currentNick) {
                // I was kicked. Mark as not joined but keep history? Or remove?
                // For now, keep history but show system message
                return s; 
            }
            
            return {
                ...s,
                channels: {
                    ...s.channels,
                    [channel]: {
                        ...ch,
                        users: ch.users.filter(u => u.replace(/^[@+]/, '') !== kickedNick)
                    }
                }
            }
         }));
    });

    // Mode Handling (Update User List prefixes)
    client.on('mode', ({ channel, actor, modes, args }) => {
        addLog(config.id, channel, sysMsg(`${actor} 设置模式: ${modes} ${args.join(' ')}`, MessageType.MODE));
        
        // Simple user prefix update logic for +o +v
        if (args.length > 0) {
            setServers(prev => prev.map(s => {
                if (s.config.id !== config.id) return s;
                const ch = s.channels[channel];
                if (!ch) return s;

                const targetNick = args[0];
                const modeChar = modes; // Simplified. Real parsing handles +o-v etc complex strings
                
                let newUsers = [...ch.users];
                const idx = newUsers.findIndex(u => u.replace(/^[@+]/, '') === targetNick);
                if (idx !== -1) {
                    let user = newUsers[idx].replace(/^[@+]/, '');
                    if (modeChar.includes('+o')) user = '@' + user;
                    else if (modeChar.includes('+v') && !user.startsWith('@')) user = '+' + user;
                    else if (modeChar.includes('-o')) user = user.replace('@', ''); // Fallback needed to check if still voice
                    else if (modeChar.includes('-v')) user = user.replace('+', '');
                    newUsers[idx] = user;
                }

                return {
                    ...s,
                    channels: {
                        ...s.channels,
                        [channel]: { ...ch, users: newUsers }
                    }
                };
            }));
        }
    });

    client.on('names', ({ channel, names }) => {
      setServers(prev => prev.map(s => {
        if (s.config.id !== config.id) return s;
        if (!s.channels[channel]) return s;
        return {
          ...s,
          channels: {
            ...s.channels,
            [channel]: { ...s.channels[channel], users: names }
          }
        };
      }));
    });
    
    client.on('topic', ({ channel, topic }) => {
        setServers(prev => prev.map(s => {
            if (s.config.id !== config.id) return s;
            if (!s.channels[channel]) return s;
            return {
                ...s,
                channels: {
                    ...s.channels,
                    [channel]: { ...s.channels[channel], topic }
                }
            };
        }));
    });

    client.on('privmsg', ({ target, sender, content, isSelf }) => {
      const isChannel = target.startsWith('#');
      let logicalChannel = isChannel ? target : (isSelf ? target : sender);
      
      setServers(prev => {
        const s = prev.find(srv => srv.config.id === config.id);
        if (!s) return prev;
        
        if (!isChannel && !s.channels[logicalChannel]) {
            return prev.map(srv => {
                if(srv.config.id !== config.id) return srv;
                return {
                    ...srv,
                    channels: {
                        ...srv.channels,
                        [logicalChannel]: {
                            name: logicalChannel,
                            type: 'query',
                            messages: [],
                            users: [sender],
                            unreadCount: 0,
                            joined: true
                        }
                    }
                }
            });
        }
        return prev;
      });

      addLog(config.id, logicalChannel, {
        id: uuid(),
        timestamp: Date.now(),
        from: sender,
        type: MessageType.PRIVMSG,
        content: content,
        isSelf: !!isSelf,
        highlight: false
      });
    });

    client.connect();
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !activeServerId) return;

    const client = clientsRef.current[activeServerId];
    if (!client) return;

    if (inputMessage.startsWith('/')) {
        const raw = inputMessage.substring(1);
        const parts = raw.split(' ');
        const cmd = parts[0].toUpperCase();

        if (cmd === 'JOIN') client.join(parts[1], parts[2]);
        else if (cmd === 'PART') client.part(activeChannelName === 'server' ? parts[1] : activeChannelName);
        else if (cmd === 'NICK') client.changeNick(parts[1]);
        else if (cmd === 'ME') {
             client.send(`PRIVMSG ${activeChannelName} :\x01ACTION ${raw.substring(3)}\x01`);
             addLog(activeServerId, activeChannelName, {
                id: uuid(), timestamp: Date.now(), from: client.currentNick, type: MessageType.ACTION, content: raw.substring(3), isSelf: true, highlight: false
             });
             setInputMessage('');
             return;
        }
        else client.send(raw);
        
        addLog(activeServerId, activeChannelName, {
            id: uuid(), timestamp: Date.now(), from: 'You', type: MessageType.SYSTEM, content: `COMMAND: ${raw}`, isSelf: true, highlight: false
        });

    } else {
        if (activeChannelName !== 'server') {
            client.sendMessage(activeChannelName, inputMessage);
        } else {
             addLog(activeServerId, 'server', {
                id: uuid(), timestamp: Date.now(), from: 'System', type: MessageType.ERROR, content: '不能在服务器控制台发送普通消息', isSelf: false, highlight: false
            });
        }
    }
    setInputMessage('');
  };

  const createServer = () => {
    const newConfig = { ...newServerForm, id: uuid() };
    const newState: IrcServerState = {
        config: newConfig,
        connected: false,
        currentNick: newConfig.nick,
        channels: {},
        serverLog: []
    };
    const newServers = [...servers, newState];
    setServers(newServers);
    saveConfig(newServers);
    setShowConnectModal(false);
    setActiveServerId(newConfig.id);
    handleConnect(newConfig);
  };
  
  // --- Feature: Moderation ---
  const handleUserAction = (action: string) => {
      if (!activeServerId || !activeChannelName || !userContextMenu) return;
      const client = clientsRef.current[activeServerId];
      const target = userContextMenu.nick.replace(/^[@+]/, '');
      
      switch(action) {
          case 'OP': client.op(activeChannelName, target); break;
          case 'DEOP': client.deop(activeChannelName, target); break;
          case 'VOICE': client.voice(activeChannelName, target); break;
          case 'DEVOICE': client.devoice(activeChannelName, target); break;
          case 'KICK': client.kick(activeChannelName, target, 'Bye'); break;
          case 'BAN': client.ban(activeChannelName, target); break;
          case 'QUERY':
               // Open DM logic handled by setActiveChannel usually, just switch or create
               break;
      }
      setUserContextMenu(null);
  };
  
  const handleModeToggle = (mode: string, value: boolean) => {
       if (!activeServerId || !activeChannelName) return;
       const client = clientsRef.current[activeServerId];
       client.setMode(activeChannelName, value ? `+${mode}` : `-${mode}`);
  };

  // --- Feature: Rich Text ---
  const insertFormat = (code: string) => {
      if (!inputRef.current) return;
      const start = inputRef.current.selectionStart || 0;
      const end = inputRef.current.selectionEnd || 0;
      const text = inputMessage;
      
      const before = text.substring(0, start);
      const selection = text.substring(start, end);
      const after = text.substring(end);
      
      // IRC Codes: Bold \x02, Italic \x1D, Underline \x1F
      const map: {[key:string]: string} = { B: '\x02', I: '\x1D', U: '\x1F' };
      const char = map[code];
      
      const newText = before + char + selection + char + after;
      setInputMessage(newText);
      
      // Restore focus
      setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(start + 1, end + 1);
      }, 0);
  };

  // UI Renders
  const activeServer = servers.find(s => s.config.id === activeServerId);
  const activeChannel = activeServer ? (activeChannelName === 'server' ? null : activeServer.channels[activeChannelName]) : null;
  const displayMessages = activeServer ? (activeChannelName === 'server' ? activeServer.serverLog : (activeChannel?.messages || [])) : [];

  return (
    <div className="flex h-screen w-full bg-gray-900 text-gray-100 font-sans" onClick={() => setUserContextMenu(null)}>
      
      {/* 1. Sidebar: Servers */}
      <div className="w-16 bg-gray-950 flex flex-col items-center py-4 space-y-4 border-r border-gray-800 shrink-0">
        {servers.map(s => (
            <div 
                key={s.config.id} 
                onClick={() => setActiveServerId(s.config.id)}
                className={`relative group cursor-pointer w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeServerId === s.config.id ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                title={s.config.name}
            >
                 <ServerIcon className="w-5 h-5" />
                 <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-950 ${s.connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            </div>
        ))}
        <button 
            onClick={() => setShowConnectModal(true)}
            className="w-10 h-10 rounded-full bg-gray-800 hover:bg-green-600 text-gray-400 hover:text-white flex items-center justify-center transition-all"
        >
            <PlusIcon className="w-6 h-6" />
        </button>
      </div>

      {/* 2. Sub-Sidebar: Channels */}
      {activeServer && (
          <div className="w-64 bg-gray-900 flex flex-col border-r border-gray-800 shrink-0 hidden md:flex">
              <div className="h-12 border-b border-gray-800 flex items-center px-4 font-bold text-gray-200 truncate">
                  {activeServer.config.name}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <div 
                    onClick={() => setActiveChannelName('server')}
                    className={`px-3 py-2 rounded cursor-pointer flex items-center space-x-2 ${activeChannelName === 'server' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                  >
                      <SettingsIcon className="w-4 h-4" />
                      <span>控制台</span>
                  </div>

                  <div className="pt-4 pb-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">频道</div>
                  {Object.values(activeServer.channels).filter((c: IrcChannel) => c.type === 'channel').map((c: IrcChannel) => (
                      <div 
                        key={c.name} 
                        onClick={() => setActiveChannelName(c.name)}
                        className={`px-3 py-2 rounded cursor-pointer flex items-center justify-between ${activeChannelName === c.name ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                      >
                          <div className="flex items-center space-x-2 truncate">
                            <HashIcon className="w-4 h-4 text-gray-500" />
                            <span className="truncate">{c.name}</span>
                          </div>
                          {c.unreadCount > 0 && (
                              <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{c.unreadCount}</span>
                          )}
                      </div>
                  ))}

                  <div className="pt-4 pb-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">私聊</div>
                  {Object.values(activeServer.channels).filter((c: IrcChannel) => c.type === 'query').map((c: IrcChannel) => (
                      <div 
                        key={c.name} 
                        onClick={() => setActiveChannelName(c.name)}
                        className={`px-3 py-2 rounded cursor-pointer flex items-center justify-between ${activeChannelName === c.name ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                      >
                           <div className="flex items-center space-x-2 truncate">
                            <UserIcon className="w-4 h-4 text-gray-500" />
                            <span className="truncate">{c.name}</span>
                          </div>
                          {c.unreadCount > 0 && <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{c.unreadCount}</span>}
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* 3. Main Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-850 relative min-w-0">
          {!activeServer ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                  <ServerIcon className="w-16 h-16 mb-4 opacity-20" />
                  <p>请添加或选择一个服务器</p>
              </div>
          ) : (
             <>
                {/* Header */}
                <div className="h-12 border-b border-gray-800 flex items-center justify-between px-6 bg-gray-900 shadow-sm shrink-0">
                    <div className="font-bold text-lg flex items-center truncate">
                        {activeChannelName === 'server' ? '系统控制台' : activeChannelName}
                        {activeChannel && activeChannel.type === 'channel' && (
                             <button onClick={() => setShowChannelSettings(true)} className="ml-2 text-gray-500 hover:text-indigo-400">
                                 <SettingsIcon className="w-4 h-4" />
                             </button>
                        )}
                        {activeChannel && activeChannel.topic && (
                            <span className="ml-4 text-xs font-normal text-gray-500 truncate max-w-md hidden md:block border-l border-gray-700 pl-4">
                                {activeChannel.topic}
                            </span>
                        )}
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {displayMessages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.isSelf ? 'justify-end' : 'justify-start'} group hover:bg-gray-800/30 p-1 rounded ${msg.highlight ? 'bg-indigo-900/20' : ''}`}>
                            <div className={`max-w-[85%] flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
                                {!msg.isSelf && msg.type !== MessageType.SYSTEM && (
                                    <span className="text-xs text-indigo-400 font-bold mb-0.5 px-2">{msg.from}</span>
                                )}
                                <div className={`px-3 py-2 rounded-lg text-sm break-all ${
                                    msg.type === MessageType.SYSTEM ? 'bg-gray-800 text-gray-400 w-full text-center italic text-xs py-1' :
                                    msg.type === MessageType.ERROR ? 'bg-red-900/50 text-red-200 w-full' :
                                    msg.type === MessageType.KICK ? 'bg-red-900/30 text-red-300 w-full text-center text-xs' :
                                    msg.type === MessageType.MODE ? 'bg-gray-800 text-indigo-300 w-full text-center text-xs' :
                                    msg.isSelf ? 'bg-indigo-600 text-white' : 'bg-gray-750 text-gray-200'
                                }`}>
                                   {formatContent(msg.content)}
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-gray-900 border-t border-gray-800 shrink-0">
                    {/* Rich Text Toolbar */}
                    <div className="flex space-x-1 mb-2">
                        <button onClick={() => insertFormat('B')} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-400 font-bold text-xs" title="Bold">B</button>
                        <button onClick={() => insertFormat('I')} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-400 italic text-xs" title="Italic">I</button>
                        <button onClick={() => insertFormat('U')} className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-400 underline text-xs" title="Underline">U</button>
                    </div>

                    <div className="flex items-center space-x-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputMessage}
                            onChange={(e) => setInputMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={activeChannelName === 'server' ? "输入命令 (例如 /JOIN #channel)..." : `发送消息至 ${activeChannelName}...`}
                            className="flex-1 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
                        />
                        <button 
                            onClick={handleSendMessage}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-md transition-colors"
                        >
                            <SendIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
             </>
          )}
      </div>
      
      {/* 4. User List & Moderation */}
      {activeChannel && activeChannel.type === 'channel' && (
          <div className="hidden lg:flex w-52 bg-gray-900 border-l border-gray-800 flex-col shrink-0">
               <div className="h-12 border-b border-gray-800 flex items-center px-4 font-bold text-gray-400 text-sm">
                  成员 ({activeChannel.users.length})
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                  {activeChannel.users.map(u => (
                      <div 
                        key={u} 
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setUserContextMenu({ x: e.clientX, y: e.clientY, nick: u });
                        }}
                        className="px-2 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded cursor-default flex items-center group"
                      >
                          <span className={`w-2 h-2 rounded-full mr-2 ${['@'].includes(u[0]) ? 'bg-red-500' : ['+'].includes(u[0]) ? 'bg-green-500' : 'bg-gray-600'}`}></span>
                          {u}
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* Context Menu for Users */}
      {userContextMenu && (
          <div className="fixed bg-gray-800 border border-gray-700 shadow-xl rounded z-50 w-32 py-1 text-sm text-gray-200" style={{ top: userContextMenu.y, left: userContextMenu.x - 128 }}>
              <div className="px-3 py-2 border-b border-gray-700 font-bold text-gray-400">{userContextMenu.nick}</div>
              <button className="w-full text-left px-3 py-1.5 hover:bg-indigo-600" onClick={() => handleUserAction('QUERY')}>私聊</button>
              <div className="border-t border-gray-700 my-1"></div>
              <button className="w-full text-left px-3 py-1.5 hover:bg-indigo-600" onClick={() => handleUserAction('OP')}>Op (+o)</button>
              <button className="w-full text-left px-3 py-1.5 hover:bg-indigo-600" onClick={() => handleUserAction('DEOP')}>Deop (-o)</button>
              <button className="w-full text-left px-3 py-1.5 hover:bg-indigo-600" onClick={() => handleUserAction('VOICE')}>Voice (+v)</button>
              <button className="w-full text-left px-3 py-1.5 hover:bg-indigo-600" onClick={() => handleUserAction('DEVOICE')}>Devoice (-v)</button>
              <div className="border-t border-gray-700 my-1"></div>
              <button className="w-full text-left px-3 py-1.5 hover:bg-red-600 text-red-200" onClick={() => handleUserAction('KICK')}>Kick</button>
              <button className="w-full text-left px-3 py-1.5 hover:bg-red-600 text-red-200" onClick={() => handleUserAction('BAN')}>Ban</button>
          </div>
      )}

      {/* Channel Settings Modal */}
      {showChannelSettings && activeChannel && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowChannelSettings(false)}>
              <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm border border-gray-700" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-4 border-b border-gray-700">
                      <h3 className="text-lg font-bold text-white">频道设置 {activeChannel.name}</h3>
                      <button onClick={() => setShowChannelSettings(false)} className="text-gray-400 hover:text-white"><XIcon className="w-5 h-5"/></button>
                  </div>
                  <div className="p-4 space-y-3">
                       <label className="flex items-center justify-between p-2 rounded hover:bg-gray-750">
                           <span className="text-sm">Topic Lock (+t)</span>
                           <input type="checkbox" onChange={(e) => handleModeToggle('t', e.target.checked)} />
                       </label>
                       <label className="flex items-center justify-between p-2 rounded hover:bg-gray-750">
                           <span className="text-sm">No Outside Msgs (+n)</span>
                           <input type="checkbox" onChange={(e) => handleModeToggle('n', e.target.checked)} />
                       </label>
                       <label className="flex items-center justify-between p-2 rounded hover:bg-gray-750">
                           <span className="text-sm">Moderated (+m)</span>
                           <input type="checkbox" onChange={(e) => handleModeToggle('m', e.target.checked)} />
                       </label>
                       <label className="flex items-center justify-between p-2 rounded hover:bg-gray-750">
                           <span className="text-sm">Invite Only (+i)</span>
                           <input type="checkbox" onChange={(e) => handleModeToggle('i', e.target.checked)} />
                       </label>
                  </div>
              </div>
          </div>
      )}

      {/* Modal: Add Server */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700">
                <div className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h3 className="text-lg font-bold text-white">添加 IRC 服务器</h3>
                    <button onClick={() => setShowConnectModal(false)} className="text-gray-400 hover:text-white">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">服务器名称</label>
                        <input className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={newServerForm.name} onChange={e => setNewServerForm({...newServerForm, name: e.target.value})} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                         <div className="col-span-2">
                            <label className="block text-xs font-bold text-gray-400 mb-1">地址 (WebSocket)</label>
                            <input placeholder="ws://..." className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={newServerForm.host} onChange={e => setNewServerForm({...newServerForm, host: e.target.value})} />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">端口</label>
                            <input type="number" className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={newServerForm.port} onChange={e => setNewServerForm({...newServerForm, port: parseInt(e.target.value)})} />
                         </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">昵称</label>
                        <input className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={newServerForm.nick} onChange={e => setNewServerForm({...newServerForm, nick: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">默认频道</label>
                        <input className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={newServerForm.channels[0]} onChange={e => setNewServerForm({...newServerForm, channels: [e.target.value]})} />
                    </div>
                </div>
                <div className="p-4 border-t border-gray-700 flex justify-end">
                    <button onClick={createServer} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-medium">
                        保存并连接
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}
