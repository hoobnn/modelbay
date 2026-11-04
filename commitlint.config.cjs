// 格式：<emoji> type(scope): 中文 subject
// 与 plein 保持一致，subject 使用中文，type/scope 用英文小写。

const norm = (s) => s?.replace(/️/g, '').trim() ?? ''

const TYPE_EMOJI = {
  feat: ['✨'],
  fix: ['🐛'],
  docs: ['📝'],
  style: ['🎨'],
  refactor: ['♻️'],
  perf: ['⚡️'],
  test: ['✅'],
  build: ['📦️'],
  ci: ['👷'],
  chore: ['🔧'],
  revert: ['⏪️'],
}

module.exports = {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      headerPattern: /^([\u{1F000}-\u{1FAFF}\u{2300}-\u{2BFF}]️?)\s([\w-]+)(?:\((\S+)\))?!?:\s(.+)/u,
      headerCorrespondence: ['emoji', 'type', 'scope', 'subject'],
    },
  },
  plugins: [
    {
      rules: {
        'emoji-type-match': ({ emoji, type }) => {
          const allowed = TYPE_EMOJI[type]
          if (!allowed) return [true]
          const ok = allowed.map(norm).includes(norm(emoji))
          return [ok, `"${emoji}" 与 type "${type}" 不匹配，应为: ${allowed[0]}`]
        },
        'no-claude-session': ({ raw }) => [
          !/^Claude-Session:/m.test(raw ?? ''),
          '提交消息不允许包含 Claude-Session 行',
        ],
        'subject-chinese': ({ type, subject }) => {
          if (type === 'revert' || !subject) return [true]
          return [/\p{Script=Han}/u.test(subject), 'subject 需使用中文描述']
        },
      },
    },
  ],
  rules: {
    'emoji-type-match': [2, 'always'],
    'no-claude-session': [2, 'always'],
    'type-enum': [2, 'always', Object.keys(TYPE_EMOJI)],
    'type-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-chinese': [2, 'always'],
    'subject-case': [0],
    'header-max-length': [2, 'always', 72],
    'body-leading-blank': [1, 'always'],
    'footer-leading-blank': [1, 'always'],
  },
}
