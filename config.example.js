// HireScout — Config Template
// Copy this file to config.js and fill in your real values

module.exports = {
  anthropicKey:     'sk-ant-YOUR-KEY-HERE',
  notionToken:      'secret_YOUR-NOTION-TOKEN-HERE',
  notionDatabaseId: 'YOUR-32-CHAR-DATABASE-ID-HERE',

  email: {
    from:             'your.gmail@gmail.com',
    to:               'your.gmail@gmail.com',
    gmailAppPassword: 'xxxx xxxx xxxx xxxx',
  },

  searches: [
    { role: 'Senior Product Manager', industry: 'B2B SaaS San Francisco Bay Area' },
    { role: 'Group Product Manager',  industry: 'Fintech San Francisco Bay Area' },
    { role: 'Director of Product',    industry: 'AI ML startup San Francisco Bay Area' },
  ],

  resume: `
    Paste your resume text here.
  `,

  minFitScore:    65,
  deduplication:  true,
};
