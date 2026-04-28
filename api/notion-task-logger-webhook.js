const FIELD_EMOJI = {
  'Status':      '🔄',
  'Priority':    '🎯',
  'Assignee':    '👤',
  'Due date':    '📅',
  'Start Date':  '📅',
  'Tags':        '🏷️',
  'Description': '📝',
  'Tracking ID': '🔢',
  'Parent-task': '🔗',
  'Sub-tasks':   '📌',
};

const SKIP_FIELDS = [
  'Task name', 'Updated at', 'Done subtask bar',
  'In progress subtask bar', 'To do subtask bar', 'Past due'
];

async function notionFetch(path, method = 'GET', body = null, token) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return res.json();
}

function extractValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'status':       return prop.status?.name;
    case 'select':       return prop.select?.name;
    case 'multi_select': return prop.multi_select?.map(t => t.name).join(', ') || null;
    case 'people':       return prop.people?.map(u => u.name).join(', ') || null;
    case 'date':         return prop.date?.start;
    case 'rich_text':    return prop.rich_text?.[0]?.plain_text;
    case 'title':        return prop.title?.[0]?.plain_text;
    case 'number':       return prop.number?.toString();
    case 'checkbox':     return prop.checkbox ? 'Bəli' : 'Xeyr';
    case 'url':          return prop.url;
    case 'email':        return prop.email;
    case 'phone_number': return prop.phone_number;
    case 'relation':     return prop.relation?.length ? `${prop.relation.length} əlaqə` : null;
    default:             return null;
  }
}

function formatBakuTime() {
  return new Date().toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN yoxdur' });

  try {
    const payload = req.body;

    const pageId = payload?.data?.id || payload?.entity?.id;
    if (!pageId) {
      return res.status(400).json({ error: 'Page ID tapılmadı' });
    }

    const changedProps = payload?.data?.properties || {};
    const now = formatBakuTime();

    // Webhook-dan dəyişən field-ləri al
    const changedFieldNames = Object.keys(changedProps).filter(f => !SKIP_FIELDS.includes(f));
    if (changedFieldNames.length === 0) {
      return res.status(200).json({ success: true, logsWritten: 0, logs: [] });
    }

    // Notion API-dən taskın cari dəyərlərini oxu (köhnə dəyər üçün)
    const currentPage = await notionFetch(`/pages/${pageId}`, 'GET', null, token);
    const currentProps = currentPage?.properties || {};

    const logLines = [];

    for (const fieldName of changedFieldNames) {
      const newValue = extractValue(changedProps[fieldName]);
      if (newValue === null || newValue === undefined || newValue === '') continue;

      const oldValue = extractValue(currentProps[fieldName]);
      const emoji = FIELD_EMOJI[fieldName] || '✏️';

      // Əvvəlki dəyər varsa və fərqlidirsə göstər
      if (oldValue && oldValue !== newValue) {
        logLines.push(`${emoji} ${fieldName}: ${oldValue} → ${newValue}`);
      } else {
        logLines.push(`${emoji} ${fieldName}: ${newValue}`);
      }
    }

    if (logLines.length === 0) {
      return res.status(200).json({ success: true, logsWritten: 0, logs: [] });
    }

    // Başlıq — bold, tarix+saat
    const headerBlock = {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `📋 ${now}` },
          annotations: { bold: true }
        }]
      }
    };

    // Log sətirləri — gri
    const logBlocks = logLines.map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: line },
          annotations: { color: 'gray' }
        }]
      }
    }));

    // Divider
    const dividerBlock = {
      object: 'block',
      type: 'divider',
      divider: {}
    };

    const blocks = [headerBlock, ...logBlocks, dividerBlock];
    await notionFetch(`/blocks/${pageId}/children`, 'PATCH', { children: blocks }, token);

    return res.status(200).json({
      success: true,
      pageId,
      logsWritten: logLines.length,
      logs: logLines
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
