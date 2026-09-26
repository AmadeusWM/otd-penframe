import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type {Rect} from './geometry.js';

const FADE_DURATION_MS = 300;

export class AreaSpotlight {
    private readonly actor: St.DrawingArea;
    private area: Rect | null = null;
    private hiding = false;

    constructor() {
        this.actor = new St.DrawingArea({
            name: 'otd-penframe-spotlight',
            reactive: false,
            can_focus: false,
            track_hover: false,
            visible: false,
        });
        this.actor.connect('repaint', () => this.paint());
        Main.layoutManager.addTopChrome(this.actor, {affectsStruts: false});
    }

    showArea(area: Rect | null): void {
        if (!area) {
            if (!this.actor.visible || this.hiding)
                return;
            this.actor.remove_all_transitions();
            this.hiding = true;
            this.actor.ease({
                opacity: 0,
                duration: FADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.actor.hide();
                    this.hiding = false;
                },
            });
            return;
        }
        const monitors = Main.layoutManager.monitors;
        if (monitors.length === 0)
            return;
        const x = Math.min(...monitors.map(monitor => monitor.x));
        const y = Math.min(...monitors.map(monitor => monitor.y));
        const right = Math.max(...monitors.map(monitor => monitor.x + monitor.width));
        const bottom = Math.max(...monitors.map(monitor => monitor.y + monitor.height));
        const changed = !this.area || area.x !== this.area.x || area.y !== this.area.y ||
            area.width !== this.area.width || area.height !== this.area.height ||
            x !== this.actor.x || y !== this.actor.y ||
            right - x !== this.actor.width || bottom - y !== this.actor.height;
        this.area = area;
        this.actor.set_position(x, y);
        this.actor.set_size(right - x, bottom - y);
        if (changed)
            this.actor.queue_repaint();
        // Motion updates geometry without restarting an in-progress fade-in.
        if (!this.actor.visible || this.hiding) {
            this.actor.remove_all_transitions();
            if (!this.actor.visible)
                this.actor.opacity = 0;
            this.hiding = false;
            this.actor.show();
            this.actor.ease({
                opacity: 255,
                duration: FADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    private paint(): void {
        const context = this.actor.get_context();
        try {
            context.setOperator(Cairo.Operator.CLEAR);
            context.paint();
            if (!this.area)
                return;
            const [width, height] = this.actor.get_surface_size();
            const x = this.area.x - this.actor.x;
            const y = this.area.y - this.actor.y;
            const right = x + this.area.width;
            const bottom = y + this.area.height;
            const radius = Math.min(8, this.area.width / 2, this.area.height / 2);
            context.setOperator(Cairo.Operator.OVER);
            context.setSourceRGBA(0, 0, 0, 0.14);
            context.setFillRule(Cairo.FillRule.EVEN_ODD);
            context.rectangle(0, 0, width, height);
            context.newSubPath();
            context.arc(right - radius, y + radius, radius, -Math.PI / 2, 0);
            context.arc(right - radius, bottom - radius, radius, 0, Math.PI / 2);
            context.arc(x + radius, bottom - radius, radius, Math.PI / 2, Math.PI);
            context.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
            context.closePath();
            context.fill();
        } finally {
            context.$dispose();
        }
    }

    destroy(): void {
        this.actor.remove_all_transitions();
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
