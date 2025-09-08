type CLIOptions = {
    keepNoOpId: boolean
    input?: string
    output?: string
}

const createSetter = (opts: CLIOptions) => <K extends keyof CLIOptions>(key: K, value: CLIOptions[K]) => {
    opts[key] = value
}

export const parseArgs = (argv: string[]): CLIOptions => {
    const opts: CLIOptions = { keepNoOpId: false }

    const aliasMap: Record<string, keyof CLIOptions> = {
        '--keep-no-opid': 'keepNoOpId',
        '-k': 'keepNoOpId',
        '--input': 'input',
        '-i': 'input',
        '--output': 'output',
        '-o': 'output',
    }

    const setOption = createSetter(opts)

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]
        const key = aliasMap[arg]
        if (!key) continue

        if (typeof opts[key] === 'boolean') {
            setOption(key, true)
        } else {
            setOption(key, argv[i + 1])
            i++ // skip next arg
        }
    }

    return opts
}
