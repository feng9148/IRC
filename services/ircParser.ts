

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

    // Replace IRC Codes
    // \x02 Bold
    // \x1D Italic
    // \x1F Underline
    // \x0F Reset (Simple implementation: close all tags. Real parser needs a stack)
    
    // Simple toggle approach (not perfect but lightweight)
    let boldOpen = false;
    let italicOpen = false;
    let underlineOpen = false;

    // Split by special chars
    const chars = escaped.split('');
    let result = '';

    for (let i = 0; i < chars.length; i++) {
        // We use the original text index to find control codes, but map to escaped char
        // Note: Escaping doesn't change the index of control codes relative to each other if we iterate the escaped string but control codes are removed? 
        // Better: Iterate original, if control code, handle tag. If char, append escaped char.
        
        // However, escaping changes string length (& -> &amp;). 
        // Correct approach: Split by control codes or iterate chars and escape on the fly if not control code.
        // Re-implementing for safety:
    }
    
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
