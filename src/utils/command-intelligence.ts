/**
 * 命令智能分析模块
 * 简化版：只包含命令解释功能
 */

// 命令解释结果
import { completionInput } from './autocomplete/input'

export interface CommandExplanation {
  command: string
  summary: string
  parts: { part: string; description: string }[]
  examples?: string[]
  relatedCommands?: string[]
}

/**
 * 检测是否是命令解释查询
 * 支持格式：?command
 */
export function isExplainQuery(input: string): boolean {
  const trimmed = input.trim()
  // ?command 格式
  if (trimmed.startsWith('?') && trimmed.length > 1) {
    return true
  }
  return false
}

/**
 * 解析命令解释查询，提取命令
 */
export function parseExplainQuery(input: string): string | null {
  const trimmed = input.trim()

  // ?command 格式
  if (trimmed.startsWith('?')) {
    return trimmed.slice(1).trim() || null
  }

  return null
}

/**
 * 获取命令的本地解释（不依赖 AI）
 */
export function getLocalCommandExplanation(command: string): CommandExplanation | null {
  const parts = completionInput(command.trim()).words
  const baseCommand = parts[0]
  
  // 本地命令解释字典
  const localExplanations: Record<string, { summary: string; options?: Record<string, string> }> = {
    ls: {
      summary: '列出目录内容',
      options: {
        '-l': '使用长格式显示详细信息',
        '-a': '显示所有文件（包括隐藏文件）',
        '-h': '以人类可读的格式显示文件大小',
        '-R': '递归列出子目录',
        '-t': '按修改时间排序',
        '-S': '按文件大小排序'
      }
    },
    cd: {
      summary: '切换当前工作目录',
      options: {
        '~': '切换到用户主目录',
        '..': '切换到上级目录',
        '-': '切换到上一个目录'
      }
    },
    cat: {
      summary: '显示文件内容',
      options: {
        '-n': '显示行号',
        '-b': '对非空行显示行号',
        '-s': '压缩连续的空行'
      }
    },
    grep: {
      summary: '在文件中搜索匹配的文本',
      options: {
        '-i': '忽略大小写',
        '-r': '递归搜索目录',
        '-n': '显示行号',
        '-v': '反向匹配（显示不匹配的行）',
        '-c': '只显示匹配的行数',
        '-l': '只显示包含匹配的文件名'
      }
    },
    find: {
      summary: '在目录树中查找文件',
      options: {
        '-name': '按文件名查找',
        '-type': '按类型查找（f=文件, d=目录）',
        '-size': '按大小查找',
        '-mtime': '按修改时间查找',
        '-exec': '对找到的文件执行命令'
      }
    },
    chmod: {
      summary: '修改文件权限',
      options: {
        '-R': '递归修改目录及其内容',
        '+x': '添加执行权限',
        '-x': '移除执行权限',
        '755': '所有者可读写执行，其他人可读执行',
        '644': '所有者可读写，其他人只读'
      }
    },
    chown: {
      summary: '修改文件所有者',
      options: {
        '-R': '递归修改目录及其内容',
        'user:group': '同时修改所有者和组'
      }
    },
    rm: {
      summary: '删除文件或目录',
      options: {
        '-r': '递归删除目录及其内容',
        '-f': '强制删除，不提示确认',
        '-i': '删除前提示确认'
      }
    },
    cp: {
      summary: '复制文件或目录',
      options: {
        '-r': '递归复制目录',
        '-p': '保留文件属性',
        '-i': '覆盖前提示确认',
        '-v': '显示复制过程'
      }
    },
    mv: {
      summary: '移动或重命名文件',
      options: {
        '-i': '覆盖前提示确认',
        '-f': '强制覆盖',
        '-v': '显示移动过程'
      }
    },
    mkdir: {
      summary: '创建目录',
      options: {
        '-p': '递归创建父目录',
        '-m': '设置目录权限'
      }
    },
    tar: {
      summary: '打包和解压文件',
      options: {
        '-c': '创建归档',
        '-x': '解压归档',
        '-v': '显示详细过程',
        '-f': '指定归档文件名',
        '-z': '使用 gzip 压缩',
        '-j': '使用 bzip2 压缩'
      }
    },
    ps: {
      summary: '显示进程状态',
      options: {
        'aux': '显示所有用户的所有进程',
        '-ef': '显示完整格式的进程列表',
        '-p': '显示指定 PID 的进程'
      }
    },
    kill: {
      summary: '终止进程',
      options: {
        '-9': '强制终止进程',
        '-15': '正常终止进程（默认）',
        '-l': '列出所有信号'
      }
    },
    top: {
      summary: '实时显示系统进程和资源使用情况'
    },
    df: {
      summary: '显示磁盘空间使用情况',
      options: {
        '-h': '以人类可读格式显示',
        '-T': '显示文件系统类型'
      }
    },
    du: {
      summary: '显示目录或文件的磁盘使用量',
      options: {
        '-h': '以人类可读格式显示',
        '-s': '只显示总计',
        '-d': '指定目录深度'
      }
    },
    free: {
      summary: '显示内存使用情况',
      options: {
        '-h': '以人类可读格式显示',
        '-m': '以 MB 为单位显示',
        '-g': '以 GB 为单位显示'
      }
    },
    ssh: {
      summary: '安全远程登录',
      options: {
        '-p': '指定端口',
        '-i': '指定私钥文件',
        '-L': '本地端口转发',
        '-R': '远程端口转发',
        '-D': '动态端口转发（SOCKS 代理）'
      }
    },
    scp: {
      summary: '安全复制文件',
      options: {
        '-r': '递归复制目录',
        '-P': '指定端口',
        '-i': '指定私钥文件'
      }
    },
    docker: {
      summary: 'Docker 容器管理',
      options: {
        'ps': '列出容器',
        'images': '列出镜像',
        'run': '运行容器',
        'stop': '停止容器',
        'rm': '删除容器',
        'logs': '查看容器日志',
        'exec': '在容器中执行命令'
      }
    },
    systemctl: {
      summary: '系统服务管理',
      options: {
        'start': '启动服务',
        'stop': '停止服务',
        'restart': '重启服务',
        'status': '查看服务状态',
        'enable': '设置开机启动',
        'disable': '禁用开机启动'
      }
    },
    git: {
      summary: 'Git 版本控制',
      options: {
        'clone': '克隆仓库',
        'pull': '拉取更新',
        'push': '推送更改',
        'commit': '提交更改',
        'branch': '分支管理',
        'checkout': '切换分支',
        'status': '查看状态',
        'log': '查看提交历史'
      }
    },
    curl: {
      summary: '传输数据的命令行工具',
      options: {
        '-X': '指定请求方法',
        '-H': '添加请求头',
        '-d': '发送 POST 数据',
        '-o': '输出到文件',
        '-O': '使用远程文件名保存',
        '-L': '跟随重定向',
        '-k': '忽略 SSL 证书验证'
      }
    },
    wget: {
      summary: '下载文件',
      options: {
        '-O': '指定输出文件名',
        '-c': '断点续传',
        '-r': '递归下载',
        '-q': '静默模式'
      }
    },
    apt: {
      summary: 'Debian/Ubuntu 包管理器',
      options: {
        'update': '更新包列表',
        'upgrade': '升级已安装的包',
        'install': '安装包',
        'remove': '卸载包',
        'search': '搜索包',
        'autoremove': '自动移除不需要的包'
      }
    },
    yum: {
      summary: 'RHEL/CentOS 包管理器',
      options: {
        'update': '更新包',
        'install': '安装包',
        'remove': '卸载包',
        'search': '搜索包',
        'list': '列出包'
      }
    },
    npm: {
      summary: 'Node.js 包管理器',
      options: {
        'install': '安装包',
        'uninstall': '卸载包',
        'update': '更新包',
        'run': '运行脚本',
        'init': '初始化项目',
        'publish': '发布包'
      }
    },
    pip: {
      summary: 'Python 包管理器',
      options: {
        'install': '安装包',
        'uninstall': '卸载包',
        'list': '列出已安装的包',
        'freeze': '输出已安装包列表',
        'show': '显示包信息'
      }
    }
  }
  
  const explanation = localExplanations[baseCommand]
  if (!explanation) {
    return null
  }
  
  const result: CommandExplanation = {
    command,
    summary: explanation.summary,
    parts: [{ part: baseCommand, description: explanation.summary }]
  }
  
  // 解析选项
  if (explanation.options) {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]
      const desc = explanation.options[part]
      if (desc) {
        result.parts.push({ part, description: desc })
      } else if (/^-[a-zA-Z]{2,}$/.test(part)) {
        const combined = [...part.slice(1)].map(flag => explanation.options?.['-' + flag])
        if (combined.every(Boolean)) result.parts.push({ part, description: combined.join('；') })
      }
    }
  }
  
  return result
}
