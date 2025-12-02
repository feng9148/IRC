import { IrcParser, ParsedIrcLine } from './ircParser';
import { IrcServerConfig } from '../types';

type EventHandler = (data: any) => void;

export class IrcClient {
  private ws: WebSocket | null = null;
  private config: IrcServerConfig;
  private listeners: { [key: string]: EventHandler[] } = {};
  public currentNick: string;

  constructor(config: IrcServerConfig) {
    this.config = config;
    this.currentNick = config.nick;
  }

  on(event: string, callback: EventHandler) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data));
    }
  }

  connect() {
    try {
      this.emit('status', 'connecting');
      // Ensure protocol is ws or wss
      let url = this.config.host;
      if (!url.startsWith('ws')) {
        url = `ws://${this.config.host}:${this.config.port}`;
      }
      
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.emit('status', 'connected');
        this.register();
      };

      this.ws.onmessage = (event) => {
        const lines = (event.data as string).split('\r\n');
        lines.forEach((line) => {
          if (!line) return;
          const parsed = IrcParser.parse(line);
          this.handleMessage(parsed, line);
        });
      };

      this.ws.onerror = (err) => {
        console.error("IRC WS Error", err);
        this.emit('error', 'WebSocket Error');
      };

      this.ws.onclose = () => {
        this.emit('status', 'disconnected');
        this.ws = null;
      };

    } catch (e) {
      console.error(e);
      this.emit('error', 'Connection Failed');
    }
  }

  disconnect() {
    if (this.ws) {
      this.send('QUIT :Web Client Disconnecting');
      this.ws.close();
    }
  }

  send(raw: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[OUT] ${raw}`);
      this.ws.send(raw + '\r\n');
    }
  }

  private register() {
    if (this.config.password) {
      this.send(`PASS ${this.config.password}`);
    }
    this.send(`NICK ${this.currentNick}`);
    this.send(`USER ${this.config.username} 0 * :${this.config.realname}`);
  }

  private handleMessage(msg: ParsedIrcLine, raw: string) {
    // Auto PONG
    if (msg.command === 'PING') {
      this.send(`PONG :${msg.params[0]}`);
      return;
    }

    this.emit('raw', raw);

    switch (msg.command) {
      case '001': // Welcome
        this.emit('registered', {});
        this.config.channels.forEach(ch => this.join(ch));
        break;

      case '433': // Nick in use
        const newNick = this.currentNick + '_';
        this.emit('system', `昵称 ${this.currentNick} 已被占用，尝试使用 ${newNick}`);
        this.currentNick = newNick;
        this.send(`NICK ${newNick}`);
        break;

      case 'JOIN':
        this.emit('join', { nick: this.getNickFromPrefix(msg.prefix), channel: msg.params[0] });
        break;

      case 'PART':
        this.emit('part', { nick: this.getNickFromPrefix(msg.prefix), channel: msg.params[0] });
        break;
      
      case 'QUIT':
        this.emit('quit', { nick: this.getNickFromPrefix(msg.prefix), reason: msg.params[0] });
        break;
      
      case 'KICK':
        // params: [channel, nick, reason]
        this.emit('kick', { 
            channel: msg.params[0], 
            kickedNick: msg.params[1], 
            actor: this.getNickFromPrefix(msg.prefix),
            reason: msg.params[2] || ''
        });
        break;

      case 'MODE':
        // params: [channel, modes, ...args] or [nick, modes]
        // Example: :Nick!user@host MODE #channel +o OtherNick
        if (msg.params[0].startsWith('#')) {
            this.emit('mode', {
                channel: msg.params[0],
                actor: this.getNickFromPrefix(msg.prefix),
                modes: msg.params[1],
                args: msg.params.slice(2)
            });
        }
        break;

      case 'PRIVMSG':
        const target = msg.params[0];
        const content = msg.params[1];
        const sender = this.getNickFromPrefix(msg.prefix);
        this.emit('privmsg', { target, sender, content });
        break;
      
      case '353': // RPL_NAMREPLY
        const channelName = msg.params[2];
        const names = msg.params[3].split(' '); // Keep prefixes like @+
        this.emit('names', { channel: channelName, names });
        break;
      
      case '475': // Bad Channel Key
         this.emit('error', `无法加入频道 ${msg.params[1]} : 密码错误`);
         break;

      case '332': // RPL_TOPIC
         this.emit('topic', { channel: msg.params[1], topic: msg.params[2] });
         break;

      default:
        break;
    }
  }

  private getNickFromPrefix(prefix: string): string {
    return prefix.split('!')[0];
  }

  join(channel: string, key?: string) {
    if (key) {
      this.send(`JOIN ${channel} ${key}`);
    } else {
      this.send(`JOIN ${channel}`);
    }
  }

  part(channel: string) {
    this.send(`PART ${channel}`);
  }

  sendMessage(target: string, text: string) {
    this.send(`PRIVMSG ${target} :${text}`);
    this.emit('privmsg', { target, sender: this.currentNick, content: text, isSelf: true });
  }

  changeNick(newNick: string) {
      this.send(`NICK ${newNick}`);
      this.currentNick = newNick;
  }

  // Moderation Commands
  kick(channel: string, nick: string, reason: string = '') {
      this.send(`KICK ${channel} ${nick} :${reason}`);
  }

  ban(channel: string, nick: string) {
      // Simple ban mask: nick!*@*
      this.send(`MODE ${channel} +b ${nick}!*@*`);
  }
  
  unban(channel: string, hostmask: string) {
      this.send(`MODE ${channel} -b ${hostmask}`);
  }

  op(channel: string, nick: string) {
      this.send(`MODE ${channel} +o ${nick}`);
  }

  deop(channel: string, nick: string) {
      this.send(`MODE ${channel} -o ${nick}`);
  }

  voice(channel: string, nick: string) {
      this.send(`MODE ${channel} +v ${nick}`);
  }

  devoice(channel: string, nick: string) {
      this.send(`MODE ${channel} -v ${nick}`);
  }

  setMode(channel: string, mode: string, param?: string) {
      const p = param ? ` ${param}` : '';
      this.send(`MODE ${channel} ${mode}${p}`);
  }
}