import * as xml from "fast-xml-parser";

export interface Enclosure {
  remoteUrl: string;
  localUrl: string;
  localPath: string;
  type: number;
}

export interface Item {
  title: string;
  link: string;
  description: string;
  enclosure: Enclosure;
  guid: string;
  pubDate: number;
}

export interface Channel {
  title: string;
  description: string;
  link: string;
  language: string;
  pubDate: number;
  lastBuildDate: number;
  items: Item[];
}

export function toXml(channel: Channel): string {
  const xmlOptions = {
    cdataTagName: "__cdata",
    ignoreAttributes: false,
  };
  const parser = new xml.j2xParser(xmlOptions);
  return '<?xml version="1.0" encoding="UTF-8"?>' + parser.parse({
    rss: {
      "@_version": "2.0",
      "channel": {
        description: {
          __cdata: channel.description,
        },
        items: channel.items.map((item) => ({
          description: {
            __cdata: item.description,
          },
          enclosure: {
            "@_type": item.enclosure.type,
            "@_url": item.enclosure.localUrl,
          },
          guid: {
            __cdata: item.guid,
          },
          link: {
            __cdata: item.link,
          },
          pubDate: new Date(item.pubDate || 0).toUTCString(),
          title: {
            __cdata: item.title,
          },
        })),
        language: {
          __cdata: channel.language,
        },
        lastBuildDate: new Date(channel.lastBuildDate || 0).toUTCString(),
        link: {
          __cdata: channel.link,
        },
        pubDate: new Date(channel.pubDate || 0).toUTCString(),
        title: {
          __cdata: channel.title,
        },
      },
    },
  });
}

export function fromXml(content: string): any {
  const xmlOptions = {
    ignoreAttributes: false,
  };
  return xml.parse(content.toString(), xmlOptions);
}
