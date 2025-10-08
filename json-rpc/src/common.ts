
export interface IDisposable {
    dispose(): void;
}

export type IEvent<T> = (listener: (e: T) => void) => IDisposable;

export class EventEmitter<T> {
    private listeners: Set<(e: T) => void> = new Set();

    readonly event: IEvent<T> = (listener: (e: T) => void) => {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    };

    fire(args: T): void {
        this.listeners.forEach(listener => listener(args));
    }
}

export interface IValueWithChangeEvent<T> {
    get value(): T;
    get onChange(): IEvent<T>;
}

export function constValue<T>(value: T): IValueWithChangeEvent<T> {
    const eventEmitter = new EventEmitter<T>();
    return {
        get value(): T {
            return value;
        },
        get onChange(): IEvent<T> {
            return eventEmitter.event;
        }
    };
}

export class ValueWithChangeEvent<T> implements IValueWithChangeEvent<T> {
    private _value: T;
    private eventEmitter: EventEmitter<T>;

    constructor(initialValue: T) {
        this._value = initialValue;
        this.eventEmitter = new EventEmitter<T>();
    }

    get value(): T {
        return this._value;
    }

    set value(newValue: T) {
        if (this._value !== newValue) {
            this._value = newValue;
            this.eventEmitter.fire(newValue);
        }
    }

    get onChange(): IEvent<T> {
        return this.eventEmitter.event;
    }
}

export function createTimeout(delay: number, callback: () => void): IDisposable {
    const handle = setTimeout(callback, delay);
    return {
        dispose: () => clearTimeout(handle)
    };
}
export function setAndDeleteOnDispose<T>(set: Set<T>, item: T): IDisposable;
export function setAndDeleteOnDispose<TKey, TValue>(set: Map<TKey, TValue>, key: TKey, item: TValue): IDisposable;
export function setAndDeleteOnDispose(
    set: Set<any> | Map<any, any>,
    keyOrItem: any,
    item?: any): IDisposable {
    if (set instanceof Set) {
        set.add(keyOrItem);
        return { dispose: () => set.delete(keyOrItem) };
    } else {
        set.set(keyOrItem, item);
        return { dispose: () => set.delete(keyOrItem) };
    }
}

export class Deferred<T = void> {
    private _state: "none" | "resolved" | "rejected" = "none";
    public readonly promise: Promise<T>;
    public resolve: (value: T | PromiseLike<T>) => void = () => { };
    public reject: (reason?: any) => void = () => { };

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    get state(): "none" | "resolved" | "rejected" {
        return this._state;
    }
}

export class Barrier<T> {
    private deferred: Deferred<T> = new Deferred();
    public readonly unlock: (value: T | PromiseLike<T>) => void = this.deferred.resolve;
    public readonly reject: (reason?: any) => void = this.deferred.reject;
    public readonly onUnlocked: Promise<T> = this.deferred.promise;

    constructor() { }

    get state(): "none" | "resolved" | "rejected" {
        return this.deferred.state;
    }
}
