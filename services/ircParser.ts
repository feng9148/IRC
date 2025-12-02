export interface ParsedIrcLine {
  prefix: string;
  command: string;
  params: string[];
}

export class IrcParser {
  /**
   * Parses a raw IRC line into prefix, command, and parameters.
   * Compliant with RFC 1459/2812.
   */
  static parse(line: string): ParsedIrcLine {
    const output: ParsedIrcLine = {
      prefix: '',
      command: '',
      params: []
    };

    let tempLine = line;

    // 1. Prefix
    if (tempLine.startsWith(':')) {
      const spaceIdx = tempLine.indexOf(' ');
      if (spaceIdx !== -1) {
        output.prefix = tempLine.substring(1, spaceIdx);
        tempLine = tempLine.substring(spaceIdx + 1);
      }
    }

    // 2. Command
    const spaceIdx = tempLine.indexOf(' ');
    if (spaceIdx !== -1) {
      output.command = tempLine.substring(0, spaceIdx).toUpperCase();
      tempLine = tempLine.substring(spaceIdx + 1);
    } else {
      output.command = tempLine.toUpperCase();
      tempLine = '';
    }

    // 3. Params
    while (tempLine) {
      if (tempLine.startsWith(':')) {
        // Trailing parameter (can contain spaces)
        output.params.push(tempLine.substring(1));
        break;
      } else {
        const nextSpace = tempLine.indexOf(' ');
        if (nextSpace !== -1) {
          output.params.push(tempLine.substring(0, nextSpace));
          tempLine = tempLine.substring(nextSpace + 1);
        } else {
          output.params.push(tempLine);
          break;
        }
      }
    }

    return output;
  }
  
  // Helper to get formatted HTML from IRC codes
  static parseContentToHtml(text: string): string {
    // Escape HTML first to prevent XSS
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    let result = '';
    let boldOpen = false;
    let italicOpen = false;
    let underlineOpen = false;

    // Iterate through chars to handle codes
    // \x02 Bold, \x1D Italic, \x1F Underline, \x0F Reset
    
    // Note: We iterate the escaped string, but careful with entities.
    // A safer way for this simple implementation is to tokenize. 
    // However, to keep it simple and performant:
    
    // We will rebuild the logic to parse original string, escape normal chars, and handle codes.
    result = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\x02') {
            result += boldOpen ? '</b>' : '<b>';
            boldOpen = !boldOpen;
        } else if (c === '\x1D') {
            result += italicOpen ? '</i>' : '<i>';
            italicOpen = !italicOpen;
        } else if (c === '\x1F') {
            result += underlineOpen ? '</u>' : '<u>';
            underlineOpen = !underlineOpen;
        } else if (c === '\x0F') {
            if (boldOpen) { result += '</b>'; boldOpen = false; }
            if (italicOpen) { result += '</i>'; italicOpen = false; }
            if (underlineOpen) { result += '</u>'; underlineOpen = false; }
        } else {
            // Escape this single char
            if (c === '&') result += '&amp;';
            else if (c === '<') result += '&lt;';
            else if (c === '>') result += '&gt;';
            else if (c === '"') result += '&quot;';
            else if (c === "'") result += '&#039;';
            else result += c;
        }
    }

    // Close any remaining
    if (boldOpen) result += '</b>';
    if (italicOpen) result += '</i>';
    if (underlineOpen) result += '</u>';

    return result;
  }
}