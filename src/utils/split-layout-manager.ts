/**
 * 分屏布局类型
 */
export type SplitDirection = 'horizontal' | 'vertical'
export type SplitLayoutType = 'single' | 'split'

/**
 * 分屏节点接口
 */
export interface SplitNode {
  id: string
  type: SplitLayoutType
  direction?: SplitDirection
  size?: number // 百分比 (0-100)
  terminalId?: string // 如果是叶子节点，关联的终端ID
  children?: [SplitNode, SplitNode] // 如果是分屏节点，包含两个子节点
}

/**
 * 分屏布局管理器
 */
export class SplitLayoutManager {
  private root: SplitNode
  private nextId: number = 1

  constructor(initialTerminalId: string) {
    this.root = {
      id: '0',
      type: 'single',
      terminalId: initialTerminalId
    }
  }

  /**
   * 获取根节点
   */
  getRoot(): SplitNode {
    return this.root
  }

  /**
   * 分割节点
   */
  split(nodeId: string, direction: SplitDirection, newTerminalId: string): boolean {
    const node = this.findNode(this.root, nodeId)
    if (!node || node.type !== 'single') {
      return false
    }

    // 将单个节点转换为分屏节点
    const oldTerminalId = node.terminalId
    node.type = 'split'
    node.direction = direction
    delete node.terminalId

    // 创建两个子节点
    node.children = [
      {
        id: `${this.nextId++}`,
        type: 'single',
        size: 50,
        terminalId: oldTerminalId
      },
      {
        id: `${this.nextId++}`,
        type: 'single',
        size: 50,
        terminalId: newTerminalId
      }
    ]

    return true
  }

  /**
   * 关闭节点
   */
  close(nodeId: string): string | null {
    if (nodeId === this.root.id) {
      // 不能关闭根节点
      return null
    }

    const parent = this.findParent(this.root, nodeId)
    if (!parent || !parent.children) {
      return null
    }

    // 找到兄弟节点
    const [child1, child2] = parent.children
    const sibling = child1.id === nodeId ? child2 : child1
    const closedTerminalId = child1.id === nodeId ? child1.terminalId : child2.terminalId

    // 将父节点替换为兄弟节点
    Object.assign(parent, sibling)

    return closedTerminalId || null
  }

  /**
   * 调整分屏大小
   */
  resize(nodeId: string, newSize: number): boolean {
    const parent = this.findParent(this.root, nodeId)
    if (!parent || !parent.children) {
      return false
    }

    const [child1, child2] = parent.children
    const targetChild = child1.id === nodeId ? child1 : child2
    const siblingChild = child1.id === nodeId ? child2 : child1

    // 限制大小在 10-90 之间
    newSize = Math.max(10, Math.min(90, newSize))

    targetChild.size = newSize
    siblingChild.size = 100 - newSize

    return true
  }

  /**
   * 获取所有终端ID
   */
  getAllTerminalIds(): string[] {
    const ids: string[] = []
    this.traverseNodes(this.root, (node) => {
      if (node.type === 'single' && node.terminalId) {
        ids.push(node.terminalId)
      }
    })
    return ids
  }

  /**
   * 获取节点数量
   */
  getNodeCount(): number {
    let count = 0
    this.traverseNodes(this.root, (node) => {
      if (node.type === 'single') {
        count++
      }
    })
    return count
  }

  /**
   * 查找节点
   */
  private findNode(node: SplitNode, nodeId: string): SplitNode | null {
    if (node.id === nodeId) {
      return node
    }

    if (node.children) {
      const found = this.findNode(node.children[0], nodeId)
      if (found) return found
      return this.findNode(node.children[1], nodeId)
    }

    return null
  }

  /**
   * 查找父节点
   */
  private findParent(node: SplitNode, childId: string): SplitNode | null {
    if (node.children) {
      if (node.children[0].id === childId || node.children[1].id === childId) {
        return node
      }

      const found = this.findParent(node.children[0], childId)
      if (found) return found
      return this.findParent(node.children[1], childId)
    }

    return null
  }

  /**
   * 遍历所有节点
   */
  private traverseNodes(node: SplitNode, callback: (node: SplitNode) => void): void {
    callback(node)
    if (node.children) {
      this.traverseNodes(node.children[0], callback)
      this.traverseNodes(node.children[1], callback)
    }
  }

  /**
   * 序列化布局
   */
  serialize(): string {
    return JSON.stringify(this.root)
  }

  /**
   * 反序列化布局
   */
  static deserialize(data: string): SplitLayoutManager | null {
    try {
      const root = JSON.parse(data) as SplitNode
      const manager = new SplitLayoutManager('')
      manager.root = root
      
      // 更新 nextId
      let maxId = 0
      manager.traverseNodes(root, (node) => {
        const id = parseInt(node.id)
        if (!isNaN(id) && id > maxId) {
          maxId = id
        }
      })
      manager.nextId = maxId + 1

      return manager
    } catch (error) {
      console.error('Failed to deserialize layout:', error)
      return null
    }
  }
}
