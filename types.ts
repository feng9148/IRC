

export enum MessageType {
  SYSTEM = 'SYSTEM',
  PRIVMSG = 'PRIVMSG',
  ACTION = 'ACTION',
  NOTICE = 'NOTICE',
  ERROR = 'ERROR',
  JOIN = 'JOIN',
  PART = 'PART',
  QUIT = 'QUIT',
  NICK = 'NICK',
  KICK = 'KICK',
  MODE = 'MODE',
}

export interface IrcMessage {
  id: string;
  timestamp: number;
  from: string;
  type: MessageType;
  content: string;
  isSelf: boolean;
  highlight: boolean;
}

export interface IrcChannel {
  name: string; // #channel or UserName for DM
  type: 'channel' | 'query' | 'server';
  messages: IrcMessage[];
  users: string[]; // List of nicknames with prefixes
  topic?: string;
  unreadCount: number;
  joined: boolean;
  key?: string; // Channel password
  modes?: { [key: string]: boolean | string }; // e.g. { t: true, n: true, k: 'password' }
}

export interface IrcServerConfig {
  id: string;
  name: string;
  host: string; // WebSocket URL (ws://...)
  port: number;
  nick: string;
  username: string;
  realname: string;
  password?: string;
  tls: boolean; // Managed by wss:// protocol in URL
  autoConnect: boolean;
  channels: string[]; // Auto join channels
  notifications?: boolean; // Enable browser notifications
}

export interface IrcServerState {
  config: IrcServerConfig;
  connected: boolean;
  currentNick: string;
  channels: { [key: string]: IrcChannel };
  serverLog: IrcMessage[]; // The "Server" tab logs
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
