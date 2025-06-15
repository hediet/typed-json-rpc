
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
