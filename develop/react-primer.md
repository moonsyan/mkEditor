# React 快速入门（Java 开发者视角）

> 更新基线：2026-08-11。本文为概念学习资料；项目的顶层状态集中在 `src/renderer/App.tsx`，不使用外部状态库。

> 只用你需要的部分，跳过复杂的概念。

---

## 一、核心思想

Java 是 **命令式** 的：告诉 UI 每一步怎么改。
React 是 **声明式** 的：描述"状态 → UI"的映射，状态变了 UI 自动变。

```java
// Java Swing（命令式）
button.setText("点击了 " + count);
label.setText("当前: " + count);

// React（声明式）
<p>点击了 {count} 次</p>  // count 变了，这个 p 自动更新
```

---

## 二、组件 = 类

```typescript
// Java 类比
class MyButton {
  private String label;
  public void render() { System.out.println("<button>" + label + "</button>"); }
}

// React 组件
function MyButton({ label }) {
  return <button>{label}</button>
}
```

**关键区别**：React 组件是**函数**，每次状态变化都会重新执行，返回新的 JSX。

---

## 三、Props = 构造参数

```typescript
// Java
public class PersonCard extends JPanel {
  public PersonCard(String name, int age) { ... }
}

// React
function PersonCard({ name, age }) {
  return <div>{name}, {age} 岁</div>
}

// 使用
<PersonCard name="张三" age=25 />
```

Props 是**只读**的，父组件可以传，子组件不能改。

---

## 四、State = 可变字段（带自动重绘）

```typescript
// Java
private int count = 0;
void increment() {
  count++;
  repaint();  // 手动通知 UI 刷新
}

// React
const [count, setCount] = useState(0)
function increment() {
  setCount(count + 1)  // 自动触发重绘
}
```

**重要**：`setCount` 不是直接赋值，是**请求重绘**。React 会批量更新，不会每次 `setState` 都立即刷新。

---

## 五、useEffect = 生命周期钩子

```typescript
// Java
@PostConstruct
void init() { ... }

@PreDestroy
void destroy() { ... }

// React
useEffect(() => {
  // 挂载时执行
  console.log('组件创建了')

  return () => {
    // 卸载时执行（等价于 @PreDestroy）
    console.log('组件销毁了')
  }
}, [])  // 空数组 = 只执行一次

// 有依赖时（等价于 PropertyChangeListener）
useEffect(() => {
  console.log('theme 变成了', theme)
}, [theme])  // theme 变化时重新执行
```

---

## 六、useCallback = 缓存方法引用

```typescript
// Java
private Runnable handler = () -> doSomething();  // 固定引用

// React（不做缓存的问题）
function MyComponent() {
  // 每次渲染都创建新的函数引用，子组件会不必要的重绘
  const handleClick = () => doSomething()
}

// 缓存（只有 id 变化才重建）
const handleClick = useCallback(() => doSomething(id), [id])
```

---

## 七、useRef = 不触发重绘的字段

```typescript
// Java
private long timer = 0;  // 普通字段

// React（普通变量在组件重绘时会丢失）
const timerRef = useRef(0)
timerRef.current = Date.now()  // 改 ref 不触发重绘
```

常用场景：
- 存 DOM 元素引用（`const divRef = useRef<HTMLDivElement>(null)`）
- 存不需要重绘的值（定时器 ID、上一次的状态）

---

## 八、项目中的实际用法

### 8.1 多文件状态管理（App.tsx）

```typescript
// 多个状态变量
const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
const [contents, setContents] = useState<Record<string, string>>({})
const [activeFileId, setActiveFileId] = useState<string>('default')

// 所有文件的"已保存"状态
const [savedMap, setSavedMap] = useState<Record<string, boolean>>({})
```

### 8.2 状态更新模式

```typescript
// 添加新文件
setOpenFiles(prev => [...prev, { id, name }])

// 更新文件内容
setContents(prev => ({ ...prev, [id]: newContent }))

// 更新保存状态（根据条件）
setSavedMap(prev => ({ ...prev, [id]: isSaved }))
```

### 8.3 副作用（自动保存）

```typescript
useEffect(() => {
  const timer = setInterval(async () => {
    // 每 30 秒自动保存
    for (const file of openFiles) {
      if (!savedMap[file.id]) {
        await saveFile(file.path, contents[file.id])
      }
    }
  }, 30000)
  return () => clearInterval(timer)  // 清理
}, [openFiles, contents, savedMap])
```

---

## 九、JSX 语法速查

```tsx
// 等价于 Java 的 HTML 模板
<div className="container">
  <h1>{title}</h1>
  <p>共有 {items.length} 项</p>

  {/* 条件渲染 */}
  {isLoggedIn ? <LogoutButton /> : <LoginButton />}

  {/* 列表渲染 */}
  {items.map(item => (
    <Item key={item.id} data={item} />
  ))}
</div>
```

---

## 十、避坑指南

| 误区 | 正确做法 |
|------|---------|
| 直接改 state 变量 | 用 setter：`setState(x)` |
| 在 useEffect 里改 state 触发无限循环 | 检查依赖数组，或用 `useRef` |
| 每次渲染都创建新函数传给子组件 | 用 `useCallback` 缓存 |
| 忘记在 useEffect 里清理定时器/监听器 | 返回清理函数 |
| 用 `id` 作 `key` 但 id 不唯一 | 用唯一稳定 ID |
