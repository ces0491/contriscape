import * as THREE from 'three';
import { GATE_RADIUS, type Gate } from './race';

const TUBE = 0.09;
/** Gold past white, so the next gate glows by night as the badges' rims do. */
const NEXT = new THREE.Color(1.6, 1.15, 0.45);
const LATER = new THREE.Color(0.62, 0.46, 0.2);
/** The finish is white where the others are gold. */
const FINISH = new THREE.Color(1.5, 1.5, 1.5);
/** Gates past the next one shown ahead, so a long course doesn't fill the sky with rings. */
const AHEAD = 4;
const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * The rings a race or a time attack is flown through. The next is bright and pulses, the few after it are dim, and passed
 * ones go.
 */
export class Gates {
  private readonly geometry = new THREE.TorusGeometry(GATE_RADIUS, TUBE, 8, 56);
  private readonly next = new THREE.MeshBasicMaterial({ color: NEXT });
  private readonly later = new THREE.MeshBasicMaterial({ color: LATER });
  private readonly finish = new THREE.MeshBasicMaterial({ color: FINISH });
  private readonly finishDim = new THREE.MeshBasicMaterial({ color: FINISH.clone().multiplyScalar(0.45) });
  private rings: THREE.Mesh[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Puts up a course's gates, or takes them down with `null`. */
  set(course: { gates: Gate[] } | null): void {
    for (const ring of this.rings) this.scene.remove(ring);
    this.rings = (course?.gates ?? []).map((gate) => {
      const ring = new THREE.Mesh(this.geometry, this.later);
      ring.position.copy(gate.at);
      ring.quaternion.setFromUnitVectors(FORWARD, gate.normal);
      ring.visible = false;
      this.scene.add(ring);
      return ring;
    });
  }

  /** Shows the gate to fly through next, and the few after it. */
  update(next: number, time: number): void {
    const last = this.rings.length - 1;
    this.rings.forEach((ring, i) => {
      ring.visible = i >= next && i <= next + AHEAD;
      if (!ring.visible) return;
      const current = i === next;
      ring.material = i === last ? (current ? this.finish : this.finishDim) : current ? this.next : this.later;
      ring.scale.setScalar(current ? 1 + 0.06 * Math.sin(time * 7) : 1);
    });
  }
}
