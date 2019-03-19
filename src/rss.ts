import * as xml from "fast-xml-parser";

export interface Enclosure {
  remoteUrl: string;
  localUrl: string;
  localPath: string;
  type: string;
  length?: string;
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
  description: string;
  image?: {
    localPath: string;
    localUrl: string;
    remoteUrl: string;
  };
  items: Item[];
  language: string;
  lastBuildDate: number;
  link: string;
  pubDate: number;
  title: string;
  owner?: {
    name: string;
    email: string;
  };
  author?: string;
  copyright?: string;
}

export function toXml(channel: Channel): string {
  const xmlOptions = {
    cdataTagName: "__cdata",
    format: true,
    ignoreAttributes: false,
  };
  const parser = new xml.j2xParser(xmlOptions);
  const feed = {
    rss: {
      "@_version": "2.0",
      "@_xmlns:atom": "http://www.w3.org/2005/Atom",
      "@_xmlns:googleplay": "http://www.google.com/schemas/play-podcasts/1.0",
      "@_xmlns:itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
      "channel": {
        "description": {
          __cdata: channel.description,
        },
        "generator": "podstash",
        "googleplay:block": "yes",
        "item": channel.items.map((item) => ({
          description: {
            __cdata: item.description,
          },
          enclosure: {
            "@_length": item.enclosure.length,
            "@_type": item.enclosure.type,
            "@_url": item.enclosure.localUrl,
          },
          guid: {
            "@_isPermaLink": "false",
            "__cdata": item.guid,
          },
          link: {
            __cdata: item.link,
          },
          pubDate: new Date(item.pubDate || 0).toUTCString(),
          title: {
            __cdata: item.title,
          },
        })),
        "itunes:block": "Yes",
        "language": {
          __cdata: channel.language,
        },
        "lastBuildDate": new Date(Date.now()).toUTCString(),
        "link": {
          __cdata: channel.link,
        },
        "title": {
          __cdata: channel.title,
        },
      },
    },
  };
  const addToChannel = (extra: any) => {
    feed.rss.channel = {
      ...feed.rss.channel,
      ...extra,
    };
  };
  if (channel.image) {
    addToChannel({
      "image": {
        link: {__cdata: channel.link},
        title: {__cdata: channel.title},
        url: {__cdata: channel.image.localUrl},
      },
      "itunes:image": {
        "@_href": channel.image.localUrl,
      },
    });
  }
  if (channel.owner) {
    addToChannel({
      "itunes:owner": {
        "itunes:email": {__cdata: channel.owner.email},
        "itunes:name": {__cdata: channel.owner.name},
      },
    });
  }
  if (channel.author) {
    addToChannel({
      "itunes:author": {__cdata: channel.author},
    });
  }
  if (channel.copyright) {
    addToChannel({
      copyright: {__cdata: channel.copyright},
    });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + parser.parse(feed);
}

export function fromXml(content: string): any {
  const xmlOptions = {
    ignoreAttributes: false,
  };
  return xml.parse(content.toString(), xmlOptions);
}
